import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server';
import {
  JOB_KINDS,
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
import { finalAssistantMessage, insertJob, startTask } from '../lib/tasks';
import { model } from '../schema';
import { requireService } from '../shared';

/** How far ahead the tick looks for meetings that may need preparation. */
const MEETING_HORIZON_MS = 8 * 3_600_000;
/** Tasks, entries, and claims read per workspace per tick. */
const SCAN_LIMIT = 500;
const REPORT_LINE_LIMIT = 2_000;
/** Statuses a dependency is finished in. Anything else keeps the dependent task waiting. */
const FINISHED = ['completed'];
const shiftKind = v.union(v.literal('work'), v.literal('review'), v.literal('prep'), v.literal('wrapup'));

/** The brief a reserved employee's standing session opens with; every real run arrives as a job. */
const STANDING_PROMPTS: Record<string, string> = {
  janitor: 'You keep this workspace’s memory. Wait for a curation run; do nothing until one arrives.',
  auditor: 'You audit this workspace’s work. Wait for an audit run; do nothing until one arrives.',
  triage: 'You answer this workspace’s incidents. Wait for a triage run; do nothing until one arrives.',
};

/**
 * The one session a reserved employee works in. Reserved kinds have no project task of their own, so
 * curation, audit, and triage runs are turns inside a session opened once and kept for good.
 */
async function standingTaskFor(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  installation: Doc<'installations'>,
  tasks: Doc<'tasks'>[],
) {
  const existing = tasks.find(
    (task) => task.employeeId === installation._id && task.status !== 'cancelled' && task.status !== 'failed',
  );
  if (existing) return existing._id;
  const version = await ctx.db.get(installation.versionId);
  const prompt = STANDING_PROMPTS[installation.kind ?? 'worker'];
  if (!version || version.retiredAt || !prompt) return undefined;
  const floor = installation.floorId ? await ctx.db.get(installation.floorId) : null;
  return startTask(ctx, {
    workspace,
    createdBy: 'schedule',
    createdByName: 'Schedule',
    employeeId: installation._id,
    version,
    title: `${installation.name ?? version.name} standing session`,
    prompt,
    floor:
      floor && floor.archivedAt === undefined
        ? { floorId: floor._id, floorContext: { name: floor.name, brief: floor.brief } }
        : undefined,
  });
}

/** The task an attendee prepares in: its work on this meeting's project, then its floor, then any. */
function prepTaskFor(entry: Doc<'calendarEntries'>, employeeId: Id<'installations'>, tasks: Doc<'tasks'>[]) {
  const own = tasks.filter(
    (task) => task.employeeId === employeeId && task.status !== 'cancelled' && task.status !== 'failed',
  );
  return (
    own.find((task) => entry.projectId && task.projectId === entry.projectId) ??
    own.find((task) => entry.floorId && task.floorId === entry.floorId) ??
    own[0]
  );
}

/** Reads one workspace's scheduling inputs, runs the planner, and enqueues what it returns. */
async function tickWorkspace(ctx: MutationCtx, workspace: Doc<'workspaces'>, now: number) {
  const settings = await settingsFor(ctx, workspace._id);
  const date = shiftDate(now, settings);
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

  const plannerTasks: PlannerTask[] = tasks.map((task) => ({
    taskId: task._id,
    employeeId: task.employeeId,
    status: task.status,
    cadence: task.cadence,
    deadlineAt: task.deadlineAt,
    unfinishedDependencies: (task.dependsOn ?? []).filter(
      (id) => !FINISHED.includes(statusById.get(id) ?? 'queued'),
    ),
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
      standingTaskId:
        kind === 'worker' ? undefined : await standingTaskFor(ctx, workspace, installation, tasks),
    });
    for (const finding of await ctx.db
      .query('auditFindings')
      .withIndex('by_employee_status', (q) => q.eq('employeeId', installation._id).eq('status', 'open'))
      .take(50))
      findings.push({ findingId: finding._id, employeeId: installation._id });
  }

  const meetings: PlannerMeeting[] = entries
    .filter((entry) => entry.kind === 'meeting' && entry.status === 'scheduled')
    .map((entry) => ({
      entryId: entry._id,
      startsAt: entry.startsAt,
      attendees: entry.attendees.flatMap((attendee) => {
        if (attendee.kind !== 'employee') return [];
        const task = prepTaskFor(entry, attendee.id as Id<'installations'>, tasks);
        return task ? [{ employeeId: attendee.id, taskId: task._id }] : [];
      }),
    }));

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
      payload: JSON.stringify(job),
    });
  return planned.length;
}

/** The five-minute scheduler. Reads every workspace's clock and open work and enqueues the day's runs. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let enqueued = 0;
    for (const workspace of await ctx.db.query('workspaces').take(200))
      enqueued += await tickWorkspace(ctx, workspace, now);
    if (enqueued) {
      const signal = await ctx.db
        .query('workerSignals')
        .withIndex('by_name', (q) => q.eq('name', 'jobs'))
        .unique();
      if (signal) await ctx.db.patch(signal._id, { revision: signal.revision + 1, updatedAt: now });
    }
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

/** Closes a shift with its report. A shift that ends without one gets an inferred report from the journal. */
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
