import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { assertEmployeeReady, assertTokenCap, assignmentForFloor, startTask } from '../lib/tasks';
import { provider } from '../schema';
import { requireService, untrustedBlock } from '../shared';
import { enqueueEmailClassificationFor } from './triage';

const inboxItem = v.object({
  externalId: v.string(),
  title: v.string(),
  preview: v.string(),
  sourceUrl: v.optional(v.string()),
  createdAt: v.number(),
});

type InboxItem = {
  externalId: string;
  title: string;
  preview: string;
  sourceUrl?: string;
  createdAt: number;
};

function assertBatch(items: InboxItem[]) {
  if (items.length > 100 || items.some((item) => item.title.length > 500 || item.preview.length > 20_000))
    throw new Error('Inbox batch is too large');
}

async function insertInboxItems(ctx: MutationCtx, connection: Doc<'connections'>, items: InboxItem[]) {
  const inserted: Id<'inbox'>[] = [];
  for (const item of items) {
    const existing = await ctx.db
      .query('inbox')
      .withIndex('by_connection_external', (q) =>
        q.eq('connectionId', connection._id).eq('externalId', item.externalId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: item.title,
        preview: item.preview,
        sourceUrl: item.sourceUrl,
        createdAt: item.createdAt,
      });
      continue;
    }
    inserted.push(
      await ctx.db.insert('inbox', {
        workspaceId: connection.workspaceId,
        connectionId: connection._id,
        externalId: item.externalId,
        provider: connection.provider,
        title: item.title,
        preview: item.preview,
        sourceUrl: item.sourceUrl,
        createdAt: item.createdAt,
        status: 'unread',
      }),
    );
  }
  return inserted;
}

/** The task an inbox item becomes, whether a person assigned it or the connection's route did. */
export function inboxTaskPrompt(item: { provider: string; title: string; preview: string }) {
  return `Review this ${item.provider} inbox item and handle it within your approved access.\n\n${untrustedBlock(
    `${item.title}\n${item.preview}`,
  )}`;
}

/**
 * A connection with a route starts a task for each new item, in the owner's name and under the
 * owner's reach, the way the owner assigning it by hand would. An employee that is not ready leaves
 * the item unread with the reason, so a delivery never fails because a route is stale.
 */
async function routeInboxItems(ctx: MutationCtx, connection: Doc<'connections'>, itemIds: Id<'inbox'>[]) {
  const route = connection.inboxRoute;
  if (!route || !itemIds.length) return;
  const workspace = await ctx.db.get(connection.workspaceId);
  if (!workspace) return;
  for (const itemId of itemIds) {
    const item = await ctx.db.get(itemId);
    if (!item) continue;
    try {
      await assertTokenCap(ctx, workspace);
      const { version } = await assertEmployeeReady(
        ctx,
        workspace,
        connection.ownerSubject,
        route.employeeId,
      );
      const taskId = await startTask(ctx, {
        workspace,
        createdBy: connection.ownerSubject,
        createdByName: connection.ownerName,
        employeeId: route.employeeId,
        version,
        title: item.title,
        prompt: inboxTaskPrompt(item),
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
}

export const ingestInbox = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id('connections'),
    items: v.array(inboxItem),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    assertBatch(args.items);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== 'connected') throw new Error('Connection is inactive');
    const inserted = await insertInboxItems(ctx, connection, args.items);
    // New mail may report an incident; the triage classifier decides, once an hour at most.
    if (inserted.length && connection.provider === 'google-workspace') {
      const workspace = await ctx.db.get(connection.workspaceId);
      if (workspace) await enqueueEmailClassificationFor(ctx, workspace);
    }
    await ctx.db.patch(connection._id, {
      inboxMode: 'push',
      cursor: args.cursor === undefined ? connection.cursor : args.cursor,
      lastCheckedAt: Date.now(),
      error: undefined,
    });
    await routeInboxItems(ctx, connection, inserted);
    return { inserted: inserted.length };
  },
});

/** Delivers one provider event to every connected account following one of its resources. */
export const ingestInboxByResource = mutation({
  args: { secret: v.string(), provider, resourceIds: v.array(v.string()), items: v.array(inboxItem) },
  handler: async (ctx, args) => {
    requireService(args.secret);
    assertBatch(args.items);
    const connections = await ctx.db
      .query('connections')
      .withIndex('by_provider_status', (q) => q.eq('provider', args.provider).eq('status', 'connected'))
      .collect();
    let delivered = 0;
    for (const connection of connections) {
      if (!connection.inboxResources.some((resource) => args.resourceIds.includes(resource))) continue;
      const inserted = await insertInboxItems(ctx, connection, args.items);
      delivered += inserted.length;
      await routeInboxItems(ctx, connection, inserted);
      if (connection.inboxMode !== 'push')
        await ctx.db.patch(connection._id, { inboxMode: 'push', lastCheckedAt: Date.now() });
    }
    return { delivered };
  },
});
