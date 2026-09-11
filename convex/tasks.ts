import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { taskReservation } from './budget';
import { canSeeConnection, cleanText, randomToken, requireWorkspace } from './shared';

async function assertEmployeeReady(ctx: any, workspace: any, actor: any, role: string, employeeId: any) {
  const installation = await ctx.db.get(employeeId);
  if (!installation || installation.workspaceId !== workspace._id) throw new Error('Employee not found');
  const version = await ctx.db.get(installation.versionId);
  if (!version || version.retiredAt) throw new Error('Employee version is retired');
  const connections = await ctx.db
    .query('connections')
    .withIndex('by_workspace', (q: any) => q.eq('workspaceId', workspace._id))
    .collect();
  const visible = connections.filter(
    (connection: any) =>
      connection.status === 'connected' && canSeeConnection(connection, actor.subject, role),
  );
  for (const capability of version.capabilities) {
    if (capability.optional) continue;
    const candidates = visible.filter((connection: any) => connection.provider === capability.provider);
    if (
      !candidates.some((connection: any) =>
        capability.tools.every((tool: string) => connection.allowedTools.includes(tool)),
      )
    ) {
      throw new Error(`Connect ${capability.provider} with the required permissions first`);
    }
  }
  return { installation, version };
}

async function reserve(ctx: any, workspace: any, amount: number) {
  if (workspace.spent + workspace.reserved + amount > workspace.monthlyBudget)
    throw new Error('Monthly workspace budget reached');
  await ctx.db.patch(workspace._id, { reserved: workspace.reserved + amount });
}

async function insertJob(
  ctx: any,
  values: {
    workspaceId: any;
    taskId: any;
    uniqueKey: string;
    kind: string;
    payload: string;
    proposalId?: any;
  },
) {
  const existing = await ctx.db
    .query('jobs')
    .withIndex('by_unique_key', (q: any) => q.eq('uniqueKey', values.uniqueKey))
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  return ctx.db.insert('jobs', {
    ...values,
    state: 'queued',
    attempts: 0,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export const create = mutation({
  args: { employeeId: v.id('installations'), prompt: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const { version } = await assertEmployeeReady(ctx, workspace, actor, role, args.employeeId);
    const amount = taskReservation(version.model);
    await reserve(ctx, workspace, amount);
    const now = Date.now();
    const taskId = await ctx.db.insert('tasks', {
      workspaceId: workspace._id,
      createdBy: actor.subject,
      employeeId: args.employeeId,
      versionId: version._id,
      employeeName: version.name,
      title: cleanText(args.title, 'Title', 200),
      prompt: cleanText(args.prompt, 'Prompt', 50_000),
      status: 'queued',
      model: version.model,
      createdAt: now,
      updatedAt: now,
      runToken: randomToken(),
      reservedCost: amount,
      budgetFinalized: false,
    });
    await ctx.db.insert('messages', {
      workspaceId: workspace._id,
      taskId,
      externalId: `initial:${taskId}`,
      role: 'user',
      text: cleanText(args.prompt, 'Prompt', 50_000),
      createdAt: now,
    });
    await insertJob(ctx, {
      workspaceId: workspace._id,
      taskId,
      uniqueKey: `start:${taskId}`,
      kind: 'start_task',
      payload: JSON.stringify({ taskId }),
    });
    return { taskId };
  },
});

export const messages = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || task.createdBy !== actor.subject)
      throw new Error('Task not found');
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_task', (q: any) => q.eq('taskId', args.taskId))
      .collect();
    return messages
      .sort((a: any, b: any) => a.createdAt - b.createdAt)
      .map((message: any) => ({
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
    const text = cleanText(args.text, 'Message', 50_000);
    if (task.budgetFinalized) {
      await reserve(ctx, workspace, task.reservedCost);
      await ctx.db.patch(task._id, { budgetFinalized: false });
    }
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
    await insertJob(ctx, {
      workspaceId: workspace._id,
      taskId: task._id,
      uniqueKey: `cancel:${task._id}`,
      kind: 'cancel_task',
      payload: JSON.stringify({ sessionId: task.sessionId }),
    });
    const patch: Record<string, unknown> = { status: 'cancelled', updatedAt: now };
    if (!task.budgetFinalized) {
      patch.budgetFinalized = true;
      await ctx.db.patch(workspace._id, { reserved: Math.max(0, workspace.reserved - task.reservedCost) });
    }
    await ctx.db.patch(task._id, patch);
    return null;
  },
});
