import { v } from 'convex/values';
import type { WorkspaceSettings } from '../../lib/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server';
import { ensureAuditRun, ensureAuditor, openFindings } from '../lib/audit';
import { attendeeEmployees, ensureMeeting, meetingTaskFor } from '../lib/meetings';
import { postShiftReport } from '../lib/posts';
import type { ReservedKind } from '../lib/reserved';
import {
  JOB_KINDS,
  PREP_LEAD_HOURS,
  dailyUsageFor,
  pacingFrom,
  planTick,
  settingsFor,
  shiftDate,
  type PlannerAlert,
  type PlannerFinding,
  type PlannerInstance,
  type PlannerMeeting,
  type PlannerTask,
} from '../lib/schedule';
import { finalAssistantMessage, insertJob, openSessionTask } from '../lib/tasks';
import { isWorkingTime, workingHoursBetween } from '../lib/time';
import { ensureTriageStaff } from '../lib/triage';
import { model } from '../schema';
import { requireService } from '../shared';
import { ensureJanitorFor } from './memory';

/** How far ahead the tick looks for meetings that may need preparation. */
const MEETING_HORIZON_MS = 8 * 3_600_000;
/** Tasks, entries, and claims read per workspace per tick. */
const SCAN_LIMIT = 500;
const REPORT_LINE_LIMIT = 2_000;
const shiftKind = v.union(v.literal('work'), v.literal('review'), v.literal('prep'), v.literal('wrapup'));

/** The brief a reserved employee's standing session opens with; every real run arrives as a job. */
const STANDING_PROMPTS: Record<ReservedKind, string> = {
  janitor: 'You keep this workspace’s memory. Wait for a curation run; do nothing until one arrives.',
  auditor: 'You audit this workspace’s work. Wait for an audit run; do nothing until one arrives.',
  triage: 'You answer this workspace’s incidents. Wait for a triage run; do nothing until one arrives.',
};

/**
 * The reserved employees every workspace has: the janitor that keeps its memory, the auditor that
 * reads its nights, and the triage instance on the reserved Triage floor. Created on the first tick
 * and found again on every one after it.
 */
async function ensureReservedStaff(ctx: MutationCtx, workspace: Doc<'workspaces'>) {
  const [janitor, auditor, triage] = await Promise.all([
    ensureJanitorFor(ctx, workspace._id),
    ensureAuditor(ctx, workspace._id),
    ensureTriageStaff(ctx, workspace, 'system'),
  ]);
  return [janitor, auditor, { installation: triage.installation, version: triage.version }];
}

/**
 * The one session a reserved employee works in. Reserved kinds have no project task of their own, so
 * curation, audit, and triage runs are turns inside a session opened once and kept for good.
 */
async function standingTaskFor(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  installation: Doc<'installations'>,
) {
  const kind = installation.kind;
  if (!kind || kind === 'worker') return undefined;
  const version = await ctx.db.get(installation.versionId);
  if (!version || version.retiredAt) return undefined;
  const floor = installation.floorId ? await ctx.db.get(installation.floorId) : null;
  return openSessionTask(ctx, {
    workspace,
    employeeId: installation._id,
    version,
    kind: 'standing',
    key: 'standing',
    title: `${installation.name ?? version.name} standing session`,
    prompt: STANDING_PROMPTS[kind],
    floor:
      floor && floor.archivedAt === undefined
        ? { floorId: floor._id, floorContext: { name: floor.name, brief: floor.brief } }
        : undefined,
  });
}

/**
 * The meetings close enough to prepare for, each with the hidden per-attendee session the prep turn
 * runs in. Creating the meeting here is what makes preparation start at the lead rather than at
 * booking time; the planner still decides whether a slot is free for it.
 */
async function meetingsInLead(
  ctx: MutationCtx,
  entries: Doc<'calendarEntries'>[],
  settings: WorkspaceSettings,
  now: number,
): Promise<PlannerMeeting[]> {
  const meetings: PlannerMeeting[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'meeting' || entry.status !== 'scheduled' || entry.startsAt <= now) continue;
    if (workingHoursBetween(now, entry.startsAt, settings) > PREP_LEAD_HOURS) continue;
    const meetingId = await ensureMeeting(ctx, entry);
    const meeting = await ctx.db.get(meetingId);
    if (!meeting || meeting.status === 'closed') continue;
    const attendees = [];
    for (const installation of await attendeeEmployees(ctx, entry))
      attendees.push({
        employeeId: String(installation._id),
        taskId: String(await meetingTaskFor(ctx, meeting, entry, installation)),
      });
    meetings.push({ entryId: entry._id, meetingId, startsAt: entry.startsAt, attendees });
  }
  return meetings;
}

/** Reads one workspace's scheduling inputs, runs the planner, and enqueues what it returns. */
async function tickWorkspace(ctx: MutationCtx, workspace: Doc<'workspaces'>, now: number) {
  const settings = await settingsFor(ctx, workspace._id);
  const date = shiftDate(now, settings);
  const working = isWorkingTime(now, settings);
  await ensureReservedStaff(ctx, workspace);
  // The auditor's night task exists before the planner runs, so the audit job can target it.
  const auditTaskId = working ? undefined : await ensureAuditRun(ctx, workspace._id, date);

  const [installations, tasks, todaysShifts, entries, alerts, proposed] = await Promise.all([
    ctx.db
      .query('installations')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('tasks')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .order('desc')
      .take(SCAN_LIMIT),
    ctx.db
      .query('shifts')
      .withIndex('by_workspace_date', (q) => q.eq('workspaceId', workspace._id).eq('date', date))
      .collect(),
    ctx.db
      .query('calendarEntries')
      .withIndex('by_workspace_start', (q) =>
        q
          .eq('workspaceId', workspace._id)
          .gte('startsAt', now)
          .lte('startsAt', now + MEETING_HORIZON_MS),
      )
      .take(SCAN_LIMIT),
    ctx.db
      .query('alerts')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id).eq('status', 'open'))
      .take(SCAN_LIMIT),
    ctx.db
      .query('memories')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id).eq('status', 'proposed'))
      .take(SCAN_LIMIT),
  ]);

  const statusById = new Map(tasks.map((task) => [task._id as string, task.status]));
  const ranToday = new Set(
    todaysShifts.filter((shift) => shift.kind === 'work').map((shift) => shift.taskId),
  );
  const reviewedToday = new Set(
    todaysShifts.filter((shift) => shift.kind === 'review').map((shift) => shift.taskId),
  );
  const running = todaysShifts.filter((shift) => shift.endedAt === undefined);

  const plannerTasks: PlannerTask[] = tasks
    // Session tasks are driven by their own job kinds; only work tasks are scheduled into shifts.
    .filter((task) => (task.kind ?? 'work') === 'work')
    .map((task) => ({
      taskId: task._id,
      employeeId: task.employeeId,
      status: task.status,
      cadence: task.cadence,
      deadlineAt: task.deadlineAt,
      // A dependency outside the scanned window counts as unfinished, so a task waits rather than races.
      unfinishedDependencies: (task.dependsOn ?? []).filter((id) => statusById.get(id) !== 'completed'),
      model: task.model,
      lastShiftDate: ranToday.has(task._id) ? date : undefined,
      lastReviewDate: reviewedToday.has(task._id) ? date : undefined,
    }));

  const instances: PlannerInstance[] = [];
  const findings: PlannerFinding[] = [];
  for (const installation of installations) {
    if (installation.status === 'retired') continue;
    const version = await ctx.db.get(installation.versionId);
    if (!version || version.retiredAt) continue;
    const kind = installation.kind ?? 'worker';
    instances.push({
      employeeId: installation._id,
      kind,
      model: version.model,
      overnightModel: installation.overnightModel,
      standingTaskId: await standingTaskFor(ctx, workspace, installation),
      ...(kind === 'auditor' && auditTaskId ? { auditTaskId } : {}),
    });
    // The same open and escalated findings the shift reads first, so ordering matches the day.
    for (const finding of await openFindings(ctx, installation._id))
      findings.push({ findingId: finding._id, employeeId: installation._id });
  }

  const meetings = await meetingsInLead(ctx, entries, settings, now);

  const { usage, tokensByTask } = await dailyUsageFor(ctx, workspace._id, settings, now);
  const triageEmployees = new Set(
    instances.filter((instance) => instance.kind === 'triage').map((instance) => instance.employeeId),
  );
  let triageUsageToday = 0;
  for (const task of tasks)
    if (triageEmployees.has(task.employeeId)) triageUsageToday += tokensByTask.get(task._id) ?? 0;

  const planned = planTick({
    now,
    settings,
    tasks: plannerTasks,
    instances,
    meetings,
    alerts: alerts.map((alert): PlannerAlert => ({
      alertId: alert._id,
      severity: alert.severity,
      createdAt: alert.createdAt,
      triageTaskId: alert.triageTaskId,
    })),
    findings,
    proposedMemories: proposed.length,
    usageToday: usage.input + usage.output,
    triageUsageToday,
    freeSlots: settings.maxConcurrentInstances - running.length,
    busyEmployeeIds: running.map((shift) => shift.employeeId),
  });

  for (const job of planned)
    await insertJob(ctx, {
      workspaceId: workspace._id,
      taskId: job.taskId as Id<'tasks'>,
      uniqueKey: job.uniqueKey,
      kind: JOB_KINDS[job.kind],
      // Every run needs the workspace it belongs to; the rest of the plan is the run's own brief.
      payload: JSON.stringify({ workspaceId: workspace._id, ...job }),
    });
  return planned.length;
}

/** The five-minute scheduler. Reads every workspace's clock and open work and enqueues the day's runs. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let enqueued = 0;
    // Workers are woken by their own one-minute cron, so the tick only has to leave the jobs behind.
    for (const workspace of await ctx.db.query('workspaces').take(200))
      enqueued += await tickWorkspace(ctx, workspace, now);
    return { enqueued };
  },
});

/** Opens a shift row when the worker begins a run, so the office and the planner see it at once. */
export const startShift = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    leaseToken: v.string(),
    model,
    kind: shiftKind,
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const leased = await ctx.db
      .query('jobs')
      .withIndex('by_task_state', (q) => q.eq('taskId', task._id).eq('state', 'leased'))
      .collect();
    if (!leased.some((job) => job.leaseToken === args.leaseToken))
      throw new Error('Job lease is no longer valid');
    const settings = await settingsFor(ctx, task.workspaceId);
    const now = Date.now();
    const date = shiftDate(now, settings);
    const shiftId = await ctx.db.insert('shifts', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      employeeId: task.employeeId,
      date,
      model: args.model,
      kind: args.kind,
      startedAt: now,
    });
    // A daily task's session completes at the end of every shift; opening the next one reopens it.
    if (task.status === 'completed') await ctx.db.patch(task._id, { status: 'running', updatedAt: now });
    return { shiftId, date };
  },
});

/**
 * Closes a shift with its report and posts it to the task's channels. A shift that ends without a
 * report gets one inferred from the journal, marked as inferred.
 */
export const endShift = mutation({
  args: {
    secret: v.string(),
    shiftId: v.id('shifts'),
    report: v.optional(
      v.object({
        done: v.array(v.string()),
        inProgress: v.array(v.string()),
        blockedOn: v.array(v.string()),
        next: v.array(v.string()),
        risks: v.array(v.string()),
        deadlineConfidence: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error('Shift not found');
    if (shift.endedAt !== undefined) return { reportId: shift.reportId ?? null };
    const task = await ctx.db.get(shift.taskId);
    if (!task) throw new Error('Task not found');
    const closing = args.report ?? {
      done: [(await finalAssistantMessage(ctx, shift.taskId))?.slice(0, REPORT_LINE_LIMIT)].filter(
        (line): line is string => Boolean(line),
      ),
      inProgress: [],
      blockedOn: [],
      next: [],
      risks: [],
    };
    const now = Date.now();
    const reportId = await ctx.db.insert('reports', {
      workspaceId: shift.workspaceId,
      taskId: shift.taskId,
      employeeId: shift.employeeId,
      shiftId: shift._id,
      done: closing.done.map((line) => line.slice(0, REPORT_LINE_LIMIT)),
      inProgress: closing.inProgress.map((line) => line.slice(0, REPORT_LINE_LIMIT)),
      blockedOn: closing.blockedOn.map((line) => line.slice(0, REPORT_LINE_LIMIT)),
      next: closing.next.map((line) => line.slice(0, REPORT_LINE_LIMIT)),
      risks: closing.risks.map((line) => line.slice(0, REPORT_LINE_LIMIT)),
      deadlineConfidence: args.report?.deadlineConfidence,
      inferred: !args.report,
      createdAt: now,
    });
    await ctx.db.patch(shift._id, { endedAt: now, reportId });
    const report = await ctx.db.get(reportId);
    if (report) await postShiftReport(ctx, task, report);
    return { reportId };
  },
});

/** Whether a task is ahead, on track, or behind, from its own last report and the hours left. */
export const pacing = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const settings = await settingsFor(ctx, task.workspaceId);
    const report = await ctx.db
      .query('reports')
      .withIndex('by_task', (q) => q.eq('taskId', task._id))
      .order('desc')
      .first();
    return {
      ...pacingFrom(Date.now(), settings, {
        deadlineAt: task.deadlineAt,
        deadlineConfidence: report?.deadlineConfidence,
      }),
      deadlineAt: task.deadlineAt,
      reportedAt: report?.createdAt,
    };
  },
});

/** Today's tokens for one workspace, against the daily cap the planner and the worker both respect. */
export const dailyUsage = query({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const settings = await settingsFor(ctx, workspace._id);
    const { usage } = await dailyUsageFor(ctx, workspace._id, settings, Date.now());
    return { ...usage, cap: settings.dailyTokenCap, date: shiftDate(Date.now(), settings) };
  },
});
