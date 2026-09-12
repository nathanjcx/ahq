import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { taskReservation } from './budget';
import { canSeeConnection, cleanText, randomToken, requireWorkspace, visibleTo } from './shared';

export const markRead = mutation({
  args: { itemId: v.id('inbox') },
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.workspaceId !== workspace._id || !visibleTo(item, actor.subject, role))
      throw new Error('Inbox item not found');
    if (item.status === 'unread') await ctx.db.patch(item._id, { status: 'read' });
    return null;
  },
});

export const assign = mutation({
  args: { itemId: v.id('inbox'), employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.workspaceId !== workspace._id || !visibleTo(item, actor.subject, role))
      throw new Error('Inbox item not found');
    if (item.taskId) return { taskId: item.taskId };
    const installation = await ctx.db.get(args.employeeId);
    if (!installation || installation.workspaceId !== workspace._id) throw new Error('Employee not found');
    const version = await ctx.db.get(installation.versionId);
    if (!version || version.retiredAt) throw new Error('Employee version is retired');
    const connections = await ctx.db
      .query('connections')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    const active = connections.filter(
      (connection) =>
        connection.status === 'connected' && canSeeConnection(connection, actor.subject, role),
    );
    for (const capability of version.capabilities) {
      if (capability.optional) continue;
      if (
        !active.some(
          (connection) =>
            connection.provider === capability.provider &&
            capability.tools.every((tool: string) => connection.allowedTools.includes(tool)),
        )
      )
        throw new Error(`Connect ${capability.provider} with the required permissions first`);
    }
    const amount = taskReservation(version.model);
    if (workspace.spent + workspace.reserved + amount > workspace.monthlyBudget)
      throw new Error('Monthly workspace budget reached');
    await ctx.db.patch(workspace._id, { reserved: workspace.reserved + amount });
    const now = Date.now();
    const prompt = cleanText(
      `Review this ${item.provider} inbox item and handle it within your approved access.\n\n${item.title}\n${item.preview}`,
      'Prompt',
      50_000,
    );
    const taskId = await ctx.db.insert('tasks', {
      workspaceId: workspace._id,
      createdBy: actor.subject,
      employeeId: installation._id,
      versionId: version._id,
      employeeName: version.name,
      title: item.title,
      prompt,
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
      externalId: `inbox:${item._id}`,
      role: 'user',
      text: prompt,
      createdAt: now,
    });
    await ctx.db.insert('jobs', {
      workspaceId: workspace._id,
      taskId,
      uniqueKey: `start:${taskId}`,
      kind: 'start_task',
      payload: JSON.stringify({ taskId, inboxItemId: item._id }),
      state: 'queued',
      attempts: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(item._id, { status: 'assigned', taskId });
    return { taskId };
  },
});
