import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { Ctx } from './shared';
import { canSeeConnection, requireWorkspace } from './shared';
import { assertEmployeeReady, assertTokenCap, assignmentForProject, startTask } from './work';

/** An inbox item is visible to whoever can use the connection that delivered it. */
async function visibleItem(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  itemId: Id<'inbox'>,
  subject: string,
): Promise<Doc<'inbox'>> {
  const item = await ctx.db.get(itemId);
  if (!item || item.workspaceId !== workspaceId) throw new Error('Inbox item not found');
  const connection = await ctx.db.get(item.connectionId);
  if (!connection || !canSeeConnection(connection, subject)) throw new Error('Inbox item not found');
  return item;
}

export const markRead = mutation({
  args: { itemId: v.id('inbox') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const item = await visibleItem(ctx, workspace._id, args.itemId, actor.subject);
    if (item.status === 'unread') await ctx.db.patch(item._id, { status: 'read' });
    return null;
  },
});

export const assign = mutation({
  args: {
    itemId: v.id('inbox'),
    employeeId: v.id('installations'),
    projectId: v.optional(v.id('projects')),
  },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const item = await visibleItem(ctx, workspace._id, args.itemId, actor.subject);
    if (item.taskId) return { taskId: item.taskId };
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, actor.subject, args.employeeId);
    const taskId = await startTask(ctx, {
      workspace,
      createdBy: actor.subject,
      createdByName: actor.name,
      employeeId: args.employeeId,
      version,
      title: item.title,
      prompt: `Review this ${item.provider} inbox item and handle it within your approved access.\n\n${item.title}\n${item.preview}`,
      project: args.projectId
        ? await assignmentForProject(ctx, workspace._id, args.projectId, args.employeeId)
        : undefined,
      messageExternalId: `inbox:${item._id}`,
      jobPayload: { inboxItemId: item._id },
    });
    await ctx.db.patch(item._id, { status: 'assigned', taskId });
    return { taskId };
  },
});
