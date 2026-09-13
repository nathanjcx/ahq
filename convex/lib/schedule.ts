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
import type { AlertPaging } from '../../lib/contracts/triage';
import type { JobKind } from '../../lib/jobs';
import { PAGING_SEVERITIES, WAIT_PAGE_DELAY_MS, emergencyOpen } from '../../lib/paging';
import type { Id } from '../_generated/dataModel';
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

/** Working hours before a meeting at which attendees prepare. */
export const PREP_LEAD_HOURS = 1;
/** Proposals that force a curation run without waiting for the night. */
export const CURATION_THRESHOLD = 20;
/** Statuses a daily task can be given its next shift from. A session completes at the end of each shift. */
const SHIFT_STATUSES: TaskStatus[] = ['queued', 'running', 'completed'];
/** Statuses a task is past scheduling from altogether. */
const CLOSED_STATUSES: TaskStatus[] = ['cancelled', 'failed'];

/** A workspace answers in UTC until an administrator picks its zone. */
const DEFAULT_TIMEZONE = 'UTC';

function settingsRow(ctx: Ctx, workspaceId: Id<'workspaces'>) {
  return ctx.db
    .query('workspaceSettings')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .unique();
}

/**
 * The workspace's settings, as every other module reads them: the saved row, or the fixed defaults
 * when nobody has opened Settings yet. The sealed alert secret is deliberately dropped here; it
 * leaves Convex only through its own service query.
 */
export async function settingsFor(ctx: Ctx, workspaceId: Id<'workspaces'>): Promise<WorkspaceSettings> {
  const row = await settingsRow(ctx, workspaceId);
  if (!row) return { ...defaultWorkspaceSettings, timezone: DEFAULT_TIMEZONE, updatedAt: 0 };
  const {
    _id: _rowId,
    _creationTime: _createdAt,
    workspaceId: _workspaceId,
    alertSecretCiphertext: _secret,
    alertSecretUpdatedAt: _secretUpdatedAt,
    ...values
  } = row;
  return values;
}

/** The settings row itself, created from the defaults the first time a policy is written. */
export async function ensureSettings(ctx: MutationCtx, workspaceId: Id<'workspaces'>) {
  const existing = await settingsRow(ctx, workspaceId);
  if (existing) return existing;
  const id = await ctx.db.insert('workspaceSettings', {
    workspaceId,
    ...defaultWorkspaceSettings,
    timezone: DEFAULT_TIMEZONE,
    updatedAt: Date.now(),
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error('Workspace settings not found');
  return created;
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

/**
 * The recorded tokens of the working day a run belongs to, and the share each task accounts for so
 * the tick can measure triage against its own allowance. The window opens at the start of the same
 * day `shiftDate` names, so an overnight run counts against the cap of the day whose night it is
 * rather than starting a fresh allowance at midnight. The index covers the workspace and the day, so
 * this reads exactly the rows the day is made of.
 */
export async function dailyUsageFor(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  settings: WorkspaceSettings,
  now: number,
) {
  const since = shiftDayStart(now, settings);
  const usage = { input: 0, cached: 0, output: 0 };
  const tokensByTask = new Map<string, number>();
  for (const row of await ctx.db
    .query('usageReports')
    .withIndex('by_workspace_created', (q) => q.eq('workspaceId', workspaceId).gte('createdAt', since))
    .collect()) {
    usage.input += row.input;
    usage.cached += row.cached;
    usage.output += row.output;
    tokensByTask.set(row.taskId, (tokensByTask.get(row.taskId) ?? 0) + row.input + row.output);
  }
  return { usage, tokensByTask };
}

/** The instant the working day a run belongs to opened, which is the window every daily count uses. */
export function shiftDayStart(now: number, settings: WorkspaceSettings) {
  return startOfDay(shiftDayAnchor(now, settings), settings.timezone);
}

/**
 * An instant inside the working day a run belongs to. Inside working hours that is now; outside them
 * it is the close that opened the current night, so an overnight run at one in the morning still
 * counts as the previous working day rather than starting the next one early.
 */
function shiftDayAnchor(now: number, settings: WorkspaceSettings) {
  if (isWorkingTime(now, settings)) return now;
  const night = overnightWindow(now, settings);
  return night ? night.start : now;
}

/** The working day a run belongs to, as the date key shifts, audits, and curation are keyed by. */
export function shiftDate(now: number, settings: WorkspaceSettings) {
  return dateKey(shiftDayAnchor(now, settings), settings.timezone);
}

/** How a report's confidence and the hours left before the deadline read as one word. */
export function pacingFrom(
  now: number,
  settings: WorkspaceSettings,
  input: { deadlineAt?: number; deadlineConfidence?: number },
) {
  const { deadlineAt, deadlineConfidence } = input;
  const workingHoursLeft = deadlineAt ? workingHoursBetween(now, deadlineAt, settings) : 0;
  if (deadlineConfidence === undefined) return { pacing: 'unknown' as const, workingHoursLeft };
  if (deadlineAt && workingHoursLeft <= 0) return { pacing: 'behind' as const, workingHoursLeft };
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
  model: ModelId;
  /** Workspace-zone date of the last work shift. */
  lastShiftDate?: string;
  /** Workspace-zone date of the last review shift. */
  lastReviewDate?: string;
  /** Set while the task waits on a person: since when, and how far its pages have run. */
  waiting?: { since: number; paging: AlertPaging; pagesSent: number };
  /** A finished one-off task whose last report named what comes next: the lines, and the day they were filed. */
  carry?: { next: string[]; reportDate: string };
}
/** One hired instance. Reserved kinds run their turns in a standing task rather than project tasks. */
export interface PlannerInstance {
  employeeId: string;
  kind: EmployeeKind;
  model: ModelId;
  overnightModel?: ModelId;
  standingTaskId?: string;
  /** The auditor's task for tonight's pass, opened by `ensureAuditRun` before the tick plans. */
  auditTaskId?: string;
}
/** A scheduled meeting and the hidden session task each attending instance prepares in. */
export interface PlannerMeeting {
  entryId: string;
  meetingId: string;
  startsAt: number;
  attendees: { employeeId: string; taskId: string }[];
}
export interface PlannerAlert {
  alertId: string;
  severity: Severity;
  createdAt: number;
  /** The task already opened for this alert, if triage has started one. */
  triageTaskId?: string;
  /** How far the emergency rule has run on this incident, from its notification ledger. */
  paging: AlertPaging;
  /** Every page ever sent for this incident, spent ones included, so a page has a stable key. */
  pagesSent: number;
  /** A triage run for this incident is queued or in flight, so a second one would only pile up. */
  runLive: boolean;
  /** The unique keys of the triage runs already enqueued for this incident. */
  runKeys: string[];
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

export type PlannedJobKind =
  'shift' | 'review_shift' | 'meeting_prep' | 'curation' | 'audit' | 'triage' | 'page';
/** The queue kind the worker implements for each planned kind; `lib/jobs.ts` names them all. */
export const JOB_KINDS: Record<PlannedJobKind, JobKind> = {
  shift: 'start_shift',
  review_shift: 'review_shift',
  meeting_prep: 'meeting_prep',
  curation: 'curation_run',
  audit: 'audit_run',
  triage: 'triage_run',
  page: 'page_alert',
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
  /** The meeting a preparation turn prepares for, and the entry it was booked as. */
  meetingId?: string;
  entryId?: string;
  /** The alert a triage run answers. */
  alertId?: string;
  /** What the last report said comes next, for a shift that picks a finished task back up. */
  carry?: string[];
  /** Why the planner chose this run. */
  reason: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Whether today's recorded tokens have spent the workspace's cap. Triage and its pages run on past
 * this; everything else the planner would have scheduled waits for tomorrow, which is why the tick
 * says so in the workspace channel rather than leaving the queue quietly empty.
 */
export function capReached(settings: WorkspaceSettings, usageToday: number) {
  return settings.dailyTokenCap > 0 && usageToday >= settings.dailyTokenCap;
}

/**
 * The scheduler, as one pure function over the workspace's clock, caps, and open work.
 *
 * Priority runs triage, preparation, work shifts (findings first, then the earliest deadline),
 * review shifts, curation, and finally audits. Triage preempts: it ignores working hours, the
 * overnight policy, and the concurrency limit, and stops only at its own allowance, because an
 * incident is why a workspace runs at night at all. Everything else fits inside the free slots,
 * takes at most one run per instance per tick, and stops at the daily token cap.
 *
 * Outside working hours the overnight policy decides what may run: `off` runs nothing, `audits_only`
 * runs the reserved nights (the audit pass and curation), and `cheap` adds work shifts on the
 * instance's overnight model. The audit policy decides what an instance with open findings may do:
 * `soft` puts the findings first that day, `hard` lets it run nothing else until they are cleared.
 */
export function planTick(input: PlannerInput): PlannedJob[] {
  const { now, settings } = input;
  const working = isWorkingTime(now, settings);
  const attended = isAttendedTime(now, settings);
  // Outside working hours the overnight policy is what opens the night at all.
  const runsWork = working || settings.overnightPolicy === 'cheap';
  const runsNights = working || settings.overnightPolicy !== 'off';
  const date = shiftDate(now, settings);
  const instances = new Map(input.instances.map((instance) => [instance.employeeId, instance]));
  const unavailable = new Set(input.busyEmployeeIds);
  const findingsByEmployee = new Map<string, string[]>();
  for (const finding of input.findings) {
    const open = findingsByEmployee.get(finding.employeeId);
    if (open) open.push(finding.findingId);
    else findingsByEmployee.set(finding.employeeId, [finding.findingId]);
  }

  const planned: PlannedJob[] = [];
  const take = (job: PlannedJob) => {
    unavailable.add(job.employeeId);
    planned.push(job);
  };

  const triageSpent = settings.triageAllowance > 0 && input.triageUsageToday >= settings.triageAllowance;
  if (!triageSpent) {
    const responders = input.instances.flatMap((instance) =>
      instance.kind === 'triage' && instance.standingTaskId
        ? [{ ...instance, standingTaskId: instance.standingTaskId }]
        : [],
    );
    const alerts = [...input.alerts].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.createdAt - b.createdAt,
    );
    for (const alert of alerts) {
      // One run per state of the incident. A run's key carries the ledger it was briefed with and
      // whether the emergency gate was open for it, so a page that lands or a gate that opens plans a
      // fresh run with the tools and the brief that go with it; nothing else does. An incident whose
      // run is already enqueued is skipped before it can take the responder, so one open alert waiting
      // on a person cannot starve every other alert of triage.
      const emergency = !attended && emergencyOpen(alert.paging, now);
      const uniqueKey = `triage:${alert.alertId}:${alert.paging.attempts}${emergency ? ':e' : ''}`;
      if (alert.runLive || alert.runKeys.includes(uniqueKey)) continue;
      const responder = responders.find((instance) => !unavailable.has(instance.employeeId));
      if (!responder) break;
      take({
        kind: 'triage',
        taskId: alert.triageTaskId ?? responder.standingTaskId,
        employeeId: responder.employeeId,
        uniqueKey,
        date,
        // An incident is never run on the cheap model, whatever the hour.
        model: responder.model,
        findingIds: [],
        alertId: alert.alertId,
        reason: `${alert.severity} alert is open`,
      });
    }
  }

  // The pages the emergency rule counts. They are sent outside attended hours, where nobody is
  // expected to be watching, and re-sent on the re-page interval until three of them stand
  // unanswered. A page costs no model tokens and no slot, so neither the cap nor the concurrency
  // limit holds it back; only an acknowledgement stops it.
  // A page rides the triage instance's standing session by preference: it runs no turn, and the
  // incident's own task is busy with one exactly when the page matters most.
  const pager = input.instances.find((instance) => instance.kind === 'triage');
  if (!attended && pager)
    for (const alert of input.alerts) {
      const { paging } = alert;
      if (!PAGING_SEVERITIES.includes(alert.severity)) continue;
      // No next page is due once three have been sent, answered or not: `nextAttemptAt` is the whole
      // cadence, so a workspace whose channels deliver nothing stops at three rather than paging on
      // every tick until the incident closes.
      if (paging.acknowledged || paging.nextAttemptAt === undefined || paging.nextAttemptAt > now) continue;
      const taskId = pager.standingTaskId ?? alert.triageTaskId;
      if (!taskId) continue;
      planned.push({
        kind: 'page',
        taskId,
        employeeId: pager.employeeId,
        uniqueKey: `page:${alert.alertId}:${alert.pagesSent + 1}`,
        date,
        model: pager.model,
        findingIds: [],
        alertId: alert.alertId,
        reason: `page ${alert.pagesSent + 1}: nobody has answered`,
      });
    }

  // A task waiting on a person is paged the same way, on any hour: the wait itself is the emergency.
  // The delay gives the app's own bell a chance first; answering or deciding settles the ledger.
  for (const task of input.tasks) {
    const wait = task.waiting;
    if (!wait || now - wait.since < WAIT_PAGE_DELAY_MS) continue;
    const { paging } = wait;
    if (paging.acknowledged || paging.nextAttemptAt === undefined || paging.nextAttemptAt > now) continue;
    planned.push({
      kind: 'page',
      taskId: task.taskId,
      employeeId: task.employeeId,
      uniqueKey: `page:${task.taskId}:${wait.pagesSent + 1}`,
      date,
      model: task.model,
      findingIds: [],
      reason: `page ${wait.pagesSent + 1}: ${task.status === 'needs_input' ? 'a question' : 'an approval'} is waiting on a person`,
    });
  }

  if (capReached(settings, input.usageToday)) return planned;

  const candidates: PlannedJob[] = [];
  const meetings = runsWork ? [...input.meetings].sort((a, b) => a.startsAt - b.startsAt) : [];
  for (const meeting of meetings) {
    if (meeting.startsAt <= now) continue;
    if (workingHoursBetween(now, meeting.startsAt, settings) > PREP_LEAD_HOURS) continue;
    for (const attendee of meeting.attendees) {
      const instance = instances.get(attendee.employeeId);
      if (!instance) continue;
      candidates.push({
        kind: 'meeting_prep',
        taskId: attendee.taskId,
        employeeId: attendee.employeeId,
        uniqueKey: `meeting_prep:${meeting.meetingId}:${attendee.employeeId}`,
        date,
        model: modelFor(working, instance),
        findingIds: [],
        meetingId: meeting.meetingId,
        entryId: meeting.entryId,
        reason: 'meeting starts within the preparation lead',
      });
    }
  }

  const open = input.tasks.filter((task) => !CLOSED_STATUSES.includes(task.status));
  // A daily task shifts every working day. A one-off task that finished with work named for the next
  // shift gets that shift on a later day, so what a report promised is not left to a person to notice.
  const shifts = runsWork
    ? open.filter(
        (task) =>
          (task.cadence === 'daily'
            ? SHIFT_STATUSES.includes(task.status)
            : task.status === 'completed' && task.carry !== undefined && task.carry.reportDate !== date) &&
          task.lastShiftDate !== date &&
          instances.has(task.employeeId),
      )
    : [];
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
      ...(task.carry ? { carry: task.carry.next } : {}),
      reason: working
        ? findingIds.length
          ? 'open findings lead the working day'
          : task.carry
            ? 'the last report left work for the next shift'
            : 'daily task has no shift today'
        : 'overnight policy is cheap',
    });
  }

  // Only a `waiting` task reviews its dependency. A `blocked` one is a person's decision to make, and
  // one a person has unblocked is `queued` and shifts like any other.
  if (working)
    for (const task of open) {
      if (task.status !== 'waiting') continue;
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

  for (const instance of runsNights ? input.instances : []) {
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

  if (!working && runsNights)
    for (const instance of input.instances) {
      if (instance.kind !== 'auditor' || !instance.auditTaskId) continue;
      candidates.push({
        kind: 'audit',
        taskId: instance.auditTaskId,
        employeeId: instance.employeeId,
        uniqueKey: `audit:${instance.employeeId}:${date}`,
        date,
        model: modelFor(false, instance),
        findingIds: [],
        reason: 'nightly audit pass',
      });
    }

  // Under a `hard` audit policy an instance with open findings runs one thing and stops: the shift
  // the findings lead, which is the first this instance has in the sorted order. Everything else it
  // might do — another task, a review, a preparation turn, a second shift later in the day — waits
  // until the findings are addressed. Under `soft` the findings lead the day and hold nothing back.
  const hard = settings.auditPolicy === 'hard';
  const clearing = new Map<string, string>();
  if (hard)
    for (const candidate of candidates)
      if (
        candidate.kind === 'shift' &&
        findingsByEmployee.has(candidate.employeeId) &&
        !clearing.has(candidate.employeeId)
      )
        clearing.set(candidate.employeeId, candidate.taskId);
  const workedToday = new Set(
    open.filter((task) => task.lastShiftDate === date).map((task) => task.employeeId),
  );
  const heldByFindings = (candidate: PlannedJob) =>
    hard &&
    findingsByEmployee.has(candidate.employeeId) &&
    (workedToday.has(candidate.employeeId) || clearing.get(candidate.employeeId) !== candidate.taskId);

  let slots = Math.max(0, input.freeSlots);
  for (const candidate of candidates) {
    if (slots <= 0) break;
    if (unavailable.has(candidate.employeeId) || heldByFindings(candidate)) continue;
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
