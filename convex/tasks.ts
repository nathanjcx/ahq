import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireProject, requireProjectMilestone } from './lib/projects';
import {
  assertDependencies,
  assertEmployeeReady,
  assertTokenCap,
  assignmentForFloor,
  dependenciesReady,
  insertJob,
  queueStartTask,
  releaseDependents,
  requireEditableTask,
  startTask,
  taskTimeline,
} from './lib/tasks';
import { cadence, taskVisibility } from './schema';
import { canSeeTask, cleanText, randomToken, requireWorkspace } from './shared';

const messageRole = v.union(v.literal('user'), v.literal('assistant'), v.literal('system'));

export const create = mutation({
  args: {
    employeeId: v.id('installations'),
    prompt: v.string(),
    title: v.string(),
    floorId: v.optional(v.id('floors')),
    projectId: v.optional(v.id('projects')),
    milestoneId: v.optional(v.id('milestones')),
    cadence: v.optional(cadence),
    deadlineAt: v.optional(v.number()),
    dependsOn: v.optional(v.array(v.id('tasks'))),
  },
  returns: v.object({ taskId: v.id('tasks') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, args.employeeId);
    const dependsOn = args.dependsOn ?? [];
    await assertDependencies(ctx, workspace._id, null, dependsOn);
    if (args.projectId) await requireProject(ctx, workspace._id, args.projectId);
    // A task on a milestone belongs to that milestone's project, whether or not the caller said so.
    const milestone = args.milestoneId
      ? await requireProjectMilestone(ctx, workspace._id, args.milestoneId, args.projectId)
      : undefined;
    const taskId = await startTask(ctx, {
      workspace,
      createdBy: actor.subject,
      createdByName: actor.name,
      employeeId: args.employeeId,
      version,
      title: args.title,
      prompt: args.prompt,
      floor: args.floorId
        ? await assignmentForFloor(ctx, workspace._id, args.floorId, args.employeeId)
        : undefined,
      projectId: args.projectId ?? milestone?.projectId,
      milestoneId: args.milestoneId,
      cadence: args.cadence,
      deadlineAt: args.deadlineAt,
      dependsOn,
    });
    return { taskId };
  },
});

/**
 * Re-points a task's dependencies. A task that is still waiting or blocked is released or left
 * waiting to match the new graph; one already handed to the queue keeps its command and the edges
 * are recorded against it.
 */
export const setDependencies = mutation({
  args: { taskId: v.id('tasks'), dependsOn: v.array(v.id('tasks')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const task = await requireEditableTask(ctx, workspace, actor, role, args.taskId);
    await assertDependencies(ctx, workspace._id, task._id, args.dependsOn);
    const ready = await dependenciesReady(ctx, args.dependsOn);
    const unstarted = task.status === 'waiting' || task.status === 'blocked';
    const release = unstarted && ready;
    await ctx.db.patch(task._id, {
      dependsOn: args.dependsOn,
      updatedAt: Date.now(),
      ...(unstarted ? { status: ready ? 'queued' : 'waiting' } : {}),
      ...(release ? { error: undefined } : {}),
    });
    if (release) await queueStartTask(ctx, task);
    return null;
  },
});

export const setDeadline = mutation({
  args: { taskId: v.id('tasks'), deadlineAt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const task = await requireEditableTask(ctx, workspace, actor, role, args.taskId);
    if (args.deadlineAt !== undefined && !Number.isFinite(args.deadlineAt))
      throw new Error('Invalid deadline');
    await ctx.db.patch(task._id, { deadlineAt: args.deadlineAt, updatedAt: Date.now() });
    return null;
  },
});

export const setCadence = mutation({
  args: { taskId: v.id('tasks'), cadence },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const task = await requireEditableTask(ctx, workspace, actor, role, args.taskId);
    await ctx.db.patch(task._id, { cadence: args.cadence, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Puts a blocked task back in the queue. The dependency that failed is not going to complete, so
 * unblocking is the person's decision to run the work anyway; the edges stay for the record.
 */
export const unblock = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const task = await requireEditableTask(ctx, workspace, actor, role, args.taskId);
    if (task.status !== 'blocked') throw new Error('This task is not blocked');
    await assertTokenCap(ctx, workspace);
    await ctx.db.patch(task._id, { status: 'queued', error: undefined, updatedAt: Date.now() });
    await queueStartTask(ctx, task);
    return null;
  },
});

export const messages = query({
  args: { taskId: v.id('tasks') },
  returns: v.array(
    v.object({
      id: v.id('messages'),
      taskId: v.id('tasks'),
      role: messageRole,
      text: v.string(),
      createdAt: v.number(),
      phase: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || !canSeeTask(task, actor.subject))
      throw new Error('Task not found');
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .collect();
    return messages
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((message) => ({
        id: message._id,
        taskId: message.taskId,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        phase: message.phase,
      }));
  },
});

export const send = mutation({
  args: { taskId: v.id('tasks'), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || task.createdBy !== actor.subject)
      throw new Error('Task not found');
    if (task.status === 'cancelled' || task.status === 'failed' || task.status === 'uncertain')
      throw new Error('This task cannot accept another message');
    await assertTokenCap(ctx, workspace);
    const text = cleanText(args.text, 'Message', 50_000);
    const now = Date.now();
    const messageId = await ctx.db.insert('messages', {
      workspaceId: workspace._id,
      taskId: task._id,
      externalId: randomToken(),
      role: 'user',
      text,
      createdAt: now,
    });
    await insertJob(ctx, {
      workspaceId: workspace._id,
      taskId: task._id,
      uniqueKey: `message:${messageId}`,
      kind: 'send_message',
      payload: JSON.stringify({ messageId, text }),
    });
    await ctx.db.patch(task._id, { status: 'queued', updatedAt: now, error: undefined });
    return null;
  },
});

export const cancel = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || task.createdBy !== actor.subject)
      throw new Error('Task not found');
    if (task.status === 'cancelled') return null;
    const now = Date.now();
    const queued = await ctx.db
      .query('jobs')
      .withIndex('by_task_state', (q) => q.eq('taskId', task._id).eq('state', 'queued'))
      .collect();
    for (const job of queued) {
      if (job.kind === 'cancel_task') continue;
      await ctx.db.patch(job._id, {
        state: 'failed',
        error: 'Task was cancelled before this command ran',
        updatedAt: now,
      });
    }
    const proposals = await ctx.db
      .query('proposals')
      .withIndex('by_task_status', (q) => q.eq('taskId', task._id))
      .collect();
    for (const proposal of proposals) {
      if (proposal.status !== 'pending' && proposal.status !== 'approved') continue;
      await ctx.db.patch(proposal._id, {
        status: 'rejected',
        result: 'Task was cancelled before this action ran',
      });
      await ctx.db.insert('actionTransitions', {
        workspaceId: workspace._id,
        proposalId: proposal._id,
        from: proposal.status,
        to: 'rejected',
        actor: actor.subject,
        at: now,
        detail: 'Task cancelled',
      });
    }
    await insertJob(ctx, {
      workspaceId: workspace._id,
      taskId: task._id,
      uniqueKey: `cancel:${task._id}`,
      kind: 'cancel_task',
      payload: JSON.stringify({ sessionId: task.sessionId }),
    });
    await ctx.db.patch(task._id, { status: 'cancelled', updatedAt: now });
    // Cancelling here never reaches the session recorder, so the waiting work is settled from here.
    await releaseDependents(ctx, task, 'cancelled');
    return null;
  },
});

export const setVisibility = mutation({
  args: { taskId: v.id('tasks'), visibility: taskVisibility },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || task.createdBy !== actor.subject)
      throw new Error('Task not found');
    await ctx.db.patch(task._id, { visibility: args.visibility });
    return null;
  },
});

/**
 * The sealed timeline. Tool-call arguments and results stay encrypted until the web service unseals
 * them. No `returns` validator: it would restate four nested journal shapes that the audit route's
 * zod schema and web-tests/contracts.types.test.ts already pin down.
 */
export const auditTimeline = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || !canSeeTask(task, actor.subject))
      throw new Error('Task not found');
    return taskTimeline(ctx, task);
  },
});
