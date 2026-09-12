import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { taskVisibility } from './schema';
import { canSeeTask, cleanText, randomToken, requireWorkspace } from './shared';
import {
  assertEmployeeReady,
  assertTokenCap,
  assignmentForProject,
  insertJob,
  startTask,
  taskTimeline,
} from './work';

export const create = mutation({
  args: {
    employeeId: v.id('installations'),
    prompt: v.string(),
    title: v.string(),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, args.employeeId);
    const taskId = await startTask(ctx, {
      workspace,
      createdBy: actor.subject,
      createdByName: actor.name,
      employeeId: args.employeeId,
      version,
      title: args.title,
      prompt: args.prompt,
      project: args.projectId
        ? await assignmentForProject(ctx, workspace._id, args.projectId, args.employeeId)
        : undefined,
    });
    return { taskId };
  },
});

export const messages = query({
  args: { taskId: v.id('tasks') },
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
    return null;
  },
});

export const setVisibility = mutation({
  args: { taskId: v.id('tasks'), visibility: taskVisibility },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || task.createdBy !== actor.subject)
      throw new Error('Task not found');
    await ctx.db.patch(task._id, { visibility: args.visibility });
    return null;
  },
});

/** The sealed timeline. Tool-call arguments and results stay encrypted until the web service unseals them. */
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
