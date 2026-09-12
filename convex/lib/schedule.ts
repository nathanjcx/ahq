import {
  defaultWorkspaceSettings,
  type ScheduleSummary,
  type Cadence,
  type EmployeeKind,
  type ModelId,
  type Severity,
  type TaskStatus,
  type WorkspaceSettings,
} from '../../lib/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { Ctx } from '../shared';
import {
  dateKey,
  isAttendedTime,
  isWorkingTime,
  overnightWindow,
  startOfDay,
  workingHoursBetween,
} from './time';

/** The zone a workspace gets until an administrator picks one. */
export const FALLBACK_TIMEZONE = 'UTC';
/** Working minutes before a meeting at which attendees prepare. */
export const PREP_LEAD_HOURS = 1;
/** Proposals that force a curation run without waiting for the night. */
export const CURATION_THRESHOLD = 20;
/** Statuses a daily task can be given its next shift from. A session completes at the end of each shift. */
const SHIFT_STATUSES: TaskStatus[] = ['queued', 'running', 'completed'];
/** Statuses a task is past scheduling from altogether. */
const CLOSED_STATUSES: TaskStatus[] = ['cancelled', 'failed'];

function settingsValues(row: Doc<'workspaceSettings'>): WorkspaceSettings {
  const { _id, _creationTime, workspaceId: _workspaceId, ...values } = row;
  return values;
}

function isMutation(ctx: Ctx): ctx is MutationCtx {
  return 'insert' in ctx.db;
}

/**
 * The workspace's settings, created from the defaults on first read inside a mutation and returned
 * unsaved from a query, so reading settings never depends on somebody having opened Settings first.
 */
export async function settingsFor(ctx: Ctx, workspaceId: Id<'workspaces'>): Promise<WorkspaceSettings> {
  const row = await ctx.db
    .query('workspaceSettings')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .unique();
  if (row) return settingsValues(row);
  const values: WorkspaceSettings = {
    ...defaultWorkspaceSettings,
    timezone: FALLBACK_TIMEZONE,
    updatedAt: Date.now(),
  };
  if (isMutation(ctx)) await ctx.db.insert('workspaceSettings', { workspaceId, ...values });
  return values;
}

/** The schedule as the office reads it: the hours, where the clock stands in them, today's tokens. */
export async function scheduleSummaryFor(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  settings: WorkspaceSettings,
  now: number,
): Promise<ScheduleSummary> {
  const { usage } = await dailyUsageFor(ctx, workspaceId, settings, now);
  return {
    timezone: settings.timezone,
    workingDays: settings.workingDays,
    startHour: settings.startHour,
    endHour: settings.endHour,
    attendedStartHour: settings.attendedStartHour,
    attendedEndHour: settings.attendedEndHour,
    overnightPolicy: settings.overnightPolicy,
    working: isWorkingTime(now, settings),
    attended: isAttendedTime(now, settings),
    usageToday: { ...usage, cap: settings.dailyTokenCap },
  };
}

/** Rows walked back through `usageReports` before a day's total is treated as good enough. */
const USAGE_SCAN_LIMIT = 5_000;

/**
 * Today's recorded tokens for one workspace, and the share each task accounts for so the tick can
 * measure triage against its own allowance. `usageReports` is indexed by task rather than by
 * workspace, so this reads back from the newest rows and stops after a bounded number of them.
 */
export async function dailyUsageFor(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  settings: WorkspaceSettings,
  now: number,
) {
  const since = startOfDay(now, settings.timezone);
  const usage = { input: 0, cached: 0, output: 0 };
  const tokensByTask = new Map<string, number>();
  let examined = 0;
  for await (const row of ctx.db.query('usageReports').order('desc')) {
    if (++examined > USAGE_SCAN_LIMIT) break;
    if (row.workspaceId !== workspaceId || row.createdAt < since) continue;
    usage.input += row.input;
    usage.cached += row.cached;
    usage.output += row.output;
    tokensByTask.set(row.taskId, (tokensByTask.get(row.taskId) ?? 0) + row.input + row.output);
  }
  return { usage, tokensByTask };
}

/**
 * The working day a run belongs to. Inside working hours that is today; outside them it is the day
 * whose close opened the current night, so an overnight run at one in the morning still counts as
 * the previous working day's shift rather than starting the next one early.
 */
export function shiftDate(now: number, settings: WorkspaceSettings) {
  if (isWorkingTime(now, settings)) return dateKey(now, settings.timezone);
  const night = overnightWindow(now, settings);
  return dateKey(night ? night.start : now, settings.timezone);
}

/** How a report's confidence and the hours left before the deadline read as one word. */
export function pacingFrom(
  now: number,
  settings: WorkspaceSettings,
  input: { deadlineAt?: number; deadlineConfidence?: number },
) {
  const { deadlineAt, deadlineConfidence } = input;
  if (deadlineConfidence === undefined) return { pacing: 'unknown' as const, workingHoursLeft: 0 };
  const workingHoursLeft = deadlineAt ? workingHoursBetween(now, deadlineAt, settings) : 0;
  if (deadlineAt && workingHoursLeft <= 0) return { pacing: 'behind' as const, workingHoursLeft: 0 };
  if (deadlineConfidence < 0.5) return { pacing: 'behind' as const, workingHoursLeft };
  if (deadlineConfidence >= 0.8) return { pacing: 'ahead' as const, workingHoursLeft };
  return { pacing: 'on_track' as const, workingHoursLeft };
}

/** One task the planner may schedule, flattened to plain values so the planner stays pure. */
export interface PlannerTask {
  taskId: string;
  employeeId: string;
  status: TaskStatus;
  cadence?: Cadence;
  deadlineAt?: number;
  /** Dependencies that have not finished; a task with any of these reviews instead of working. */
  unfinishedDependencies: string[];
  model: ModelId;
  /** Workspace-zone date of the last work shift. */
  lastShiftDate?: string;
  /** Workspace-zone date of the last review shift. */
  lastReviewDate?: string;
}
/** One hired instance. Reserved kinds run their turns in a standing task rather than project tasks. */
export interface PlannerInstance {
  employeeId: string;
  kind: EmployeeKind;
  model: ModelId;
  overnightModel?: ModelId;
  standingTaskId?: string;
}
/** A scheduled meeting and the task each attending instance prepares in. */
export interface PlannerMeeting {
  entryId: string;
  startsAt: number;
  attendees: { employeeId: string; taskId: string }[];
}
export interface PlannerAlert {
  alertId: string;
  severity: Severity;
  createdAt: number;
  /** The task already opened for this alert, if triage has started one. */
  triageTaskId?: string;
}
export interface PlannerFinding {
  findingId: string;
  employeeId: string;
}
/** Everything one tick of the scheduler reads. */
export interface PlannerInput {
  now: number;
  settings: WorkspaceSettings;
  tasks: PlannerTask[];
  instances: PlannerInstance[];
  meetings: PlannerMeeting[];
  alerts: PlannerAlert[];
  /** Open audit findings, which lead the day for the instance they are against. */
  findings: PlannerFinding[];
  /** Memory claims waiting for the janitor. */
  proposedMemories: number;
  /** Tokens recorded today, against `dailyTokenCap`. */
  usageToday: number;
  /** Tokens recorded today by triage work, against `triageAllowance`. */
  triageUsageToday: number;
  /** `maxConcurrentInstances` minus the shifts already running. */
  freeSlots: number;
  /** Instances already inside a shift; one instance runs one shift at a time. */
  busyEmployeeIds: string[];
}

export type PlannedJobKind = 'shift' | 'review_shift' | 'prep_turn' | 'curation' | 'audit' | 'triage';
/** The queue kind the worker implements for each planned kind. */
export const JOB_KINDS: Record<PlannedJobKind, string> = {
  shift: 'start_shift',
  review_shift: 'review_shift',
  prep_turn: 'prep_turn',
  curation: 'curation_run',
  audit: 'audit_run',
  triage: 'triage_run',
};

/** One job the tick will enqueue. `uniqueKey` is what keeps a run to once per task per date. */
export interface PlannedJob {
  kind: PlannedJobKind;
  taskId: string;
  employeeId: string;
  uniqueKey: string;
  /** The working day the run belongs to. */
  date: string;
  model: ModelId;
  /** Open findings this run clears before anything else. */
  findingIds: string[];
  /** The meeting a prep turn prepares for. */
  entryId?: string;
  /** The alert a triage run answers. */
  alertId?: string;
  /** Why the planner chose this run. */
  reason: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The scheduler, as one pure function over the workspace's clock, caps, and open work.
 *
 * Priority runs triage, preparation, work shifts (findings first, then the earliest deadline),
 * review shifts, curation, and finally audits. Triage preempts: it ignores working hours and the
 * concurrency limit, and stops only at its own allowance. Everything else fits inside the free
 * slots, takes at most one run per instance per tick, and stops at the daily token cap.
 */
export function planTick(input: PlannerInput): PlannedJob[] {
  const { now, settings } = input;
  const working = isWorkingTime(now, settings);
  const date = shiftDate(now, settings);
  const instances = new Map(input.instances.map((instance) => [instance.employeeId, instance]));
  const unavailable = new Set(input.busyEmployeeIds);
  const findingsByEmployee = new Map<string, string[]>();
  for (const finding of input.findings)
    findingsByEmployee.set(finding.employeeId, [
      ...(findingsByEmployee.get(finding.employeeId) ?? []),
      finding.findingId,
    ]);

  const planned: PlannedJob[] = [];
  const take = (job: PlannedJob) => {
    unavailable.add(job.employeeId);
    planned.push(job);
  };

  const triageSpent = settings.triageAllowance > 0 && input.triageUsageToday >= settings.triageAllowance;
  if (!triageSpent) {
    const responders = input.instances.filter(
      (instance) => instance.kind === 'triage' && instance.standingTaskId,
    );
    const alerts = [...input.alerts].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.createdAt - b.createdAt,
    );
    for (const alert of alerts) {
      const responder = responders.find((instance) => !unavailable.has(instance.employeeId));
      if (!responder) break;
      take({
        kind: 'triage',
        taskId: alert.triageTaskId ?? (responder.standingTaskId as string),
        employeeId: responder.employeeId,
        uniqueKey: `triage:${alert.alertId}`,
        date,
        model: modelFor(false, responder),
        findingIds: [],
        alertId: alert.alertId,
        reason: `${alert.severity} alert is open`,
      });
    }
  }

  if (settings.dailyTokenCap > 0 && input.usageToday >= settings.dailyTokenCap) return planned;

  const candidates: PlannedJob[] = [];
  for (const meeting of [...input.meetings].sort((a, b) => a.startsAt - b.startsAt)) {
    if (meeting.startsAt <= now) continue;
    if (workingHoursBetween(now, meeting.startsAt, settings) > PREP_LEAD_HOURS) continue;
    for (const attendee of meeting.attendees) {
      const instance = instances.get(attendee.employeeId);
      if (!instance) continue;
      candidates.push({
        kind: 'prep_turn',
        taskId: attendee.taskId,
        employeeId: attendee.employeeId,
        uniqueKey: `prep:${meeting.entryId}:${attendee.employeeId}`,
        date,
        model: modelFor(working, instance),
        findingIds: [],
        entryId: meeting.entryId,
        reason: 'meeting starts within the preparation lead',
      });
    }
  }

  const open = input.tasks.filter((task) => !CLOSED_STATUSES.includes(task.status));
  const shifts = open.filter(
    (task) =>
      task.cadence === 'daily' &&
      SHIFT_STATUSES.includes(task.status) &&
      task.unfinishedDependencies.length === 0 &&
      task.lastShiftDate !== date &&
      (working || settings.overnightPolicy === 'cheap') &&
      instances.has(task.employeeId),
  );
  const leadsTheDay = (task: PlannerTask) => (findingsByEmployee.has(task.employeeId) ? 0 : 1);
  shifts.sort(
    (a, b) => leadsTheDay(a) - leadsTheDay(b) || (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity),
  );
  for (const task of shifts) {
    const instance = instances.get(task.employeeId);
    if (!instance) continue;
    const findingIds = findingsByEmployee.get(task.employeeId) ?? [];
    candidates.push({
      kind: 'shift',
      taskId: task.taskId,
      employeeId: task.employeeId,
      uniqueKey: `shift:${task.taskId}:${date}`,
      date,
      model: modelFor(working, instance, task.model),
      findingIds,
      reason: working
        ? findingIds.length
          ? 'open findings lead the working day'
          : 'daily task has no shift today'
        : 'overnight policy is cheap',
    });
  }

  if (working)
    for (const task of open) {
      if (task.unfinishedDependencies.length === 0 && task.status !== 'waiting') continue;
      if (task.lastReviewDate === date || !instances.has(task.employeeId)) continue;
      candidates.push({
        kind: 'review_shift',
        taskId: task.taskId,
        employeeId: task.employeeId,
        uniqueKey: `review:${task.taskId}:${date}`,
        date,
        model: task.model,
        findingIds: [],
        reason: 'waiting on an unfinished dependency',
      });
    }

  for (const instance of input.instances) {
    if (instance.kind !== 'janitor' || !instance.standingTaskId) continue;
    const batch = Math.floor(input.proposedMemories / CURATION_THRESHOLD);
    if (!batch && working) continue;
    candidates.push({
      kind: 'curation',
      taskId: instance.standingTaskId,
      employeeId: instance.employeeId,
      uniqueKey: batch
        ? `curation:${instance.employeeId}:${date}:${batch}`
        : `curation:${instance.employeeId}:${date}`,
      date,
      model: modelFor(working, instance),
      findingIds: [],
      reason: batch ? `${input.proposedMemories} claims are waiting` : 'nightly curation',
    });
  }

  if (!working)
    for (const instance of input.instances) {
      if (instance.kind !== 'auditor' || !instance.standingTaskId) continue;
      candidates.push({
        kind: 'audit',
        taskId: instance.standingTaskId,
        employeeId: instance.employeeId,
        uniqueKey: `audit:${instance.employeeId}:${date}`,
        date,
        model: modelFor(false, instance),
        findingIds: [],
        reason: 'nightly audit pass',
      });
    }

  let slots = Math.max(0, input.freeSlots);
  for (const candidate of candidates) {
    if (slots <= 0) break;
    if (unavailable.has(candidate.employeeId)) continue;
    take(candidate);
    slots -= 1;
  }
  return planned;
}

/** Outside working hours a run uses the instance's overnight model when it has one. */
function modelFor(working: boolean, instance: PlannerInstance, taskModel?: ModelId) {
  const base = taskModel ?? instance.model;
  return working ? base : (instance.overnightModel ?? base);
}
