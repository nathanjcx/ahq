import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { untrustedBlock } from '../shared';
import { assertEmployeeReady, assertTokenCap, assignmentForFloor, startTask } from './tasks';

/**
 * The task an inbox item becomes. A person assigning it gives no brief and the employee reviews the
 * item; the classifier's route gives the one line it decided. Either way the item itself is
 * material, and an answer goes back through the connected tools, where it becomes a proposal.
 */
export function inboxTaskPrompt(item: { provider: string; title: string; preview: string }, brief?: string) {
  return [
    brief ?? `Review this ${item.provider} inbox item and handle it within your approved access.`,
    untrustedBlock(`${item.title}\n${item.preview}`),
    'If the item needs an answer, write the reply with the connected tools for this provider; it reaches the person as a proposal to approve, never as a message here.',
  ].join('\n\n');
}

/**
 * A connection's route starts a task for an item the classifier said to act on, in the owner's name
 * and under the owner's reach, the way the owner assigning it by hand would. An employee that is not
 * ready leaves the item unread with the reason, so a delivery never fails because a route is stale.
 */
export async function routeInboxItem(ctx: MutationCtx, item: Doc<'inbox'>, brief: string) {
  const connection = await ctx.db.get(item.connectionId);
  const route = connection?.inboxRoute;
  if (!connection || !route || item.status !== 'unread') return;
  const workspace = await ctx.db.get(connection.workspaceId);
  if (!workspace) return;
  try {
    await assertTokenCap(ctx, workspace);
    const { version } = await assertEmployeeReady(ctx, workspace, connection.ownerSubject, route.employeeId);
    const taskId = await startTask(ctx, {
      workspace,
      createdBy: connection.ownerSubject,
      createdByName: connection.ownerName,
      employeeId: route.employeeId,
      version,
      title: item.title,
      prompt: inboxTaskPrompt(item, brief),
      floor: route.floorId
        ? await assignmentForFloor(ctx, workspace._id, route.floorId, route.employeeId)
        : undefined,
      messageExternalId: `inbox:${item._id}`,
      jobPayload: { inboxItemId: item._id },
    });
    await ctx.db.patch(item._id, { status: 'assigned', taskId });
  } catch (error) {
    await ctx.db.patch(connection._id, {
      error: `Inbox route: ${error instanceof Error ? error.message : 'could not start the task'}`.slice(
        0,
        500,
      ),
    });
  }
}
