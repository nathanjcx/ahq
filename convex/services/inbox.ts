import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { provider } from '../schema';
import { requireService } from '../shared';

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
  let inserted = 0;
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
    });
    inserted += 1;
  }
  return inserted;
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
    await ctx.db.patch(connection._id, {
      inboxMode: 'push',
      cursor: args.cursor === undefined ? connection.cursor : args.cursor,
      lastCheckedAt: Date.now(),
      error: undefined,
    });
    return { inserted };
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
      delivered += await insertInboxItems(ctx, connection, args.items);
      if (connection.inboxMode !== 'push')
        await ctx.db.patch(connection._id, { inboxMode: 'push', lastCheckedAt: Date.now() });
    }
    return { delivered };
  },
});
