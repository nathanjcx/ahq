import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { provider } from '../schema';
import { requireService } from '../shared';
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

/**
 * New mail may report an incident, and a routed connection's mail needs a decision before an
 * employee spends a session on it. Both are the classifier's, so it runs whenever either applies.
 */
async function classifyNewItems(ctx: MutationCtx, connection: Doc<'connections'>) {
  if (connection.provider !== 'google-workspace' && !connection.inboxRoute) return;
  const workspace = await ctx.db.get(connection.workspaceId);
  if (workspace) await enqueueEmailClassificationFor(ctx, workspace);
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
    if (inserted.length) await classifyNewItems(ctx, connection);
    await ctx.db.patch(connection._id, {
      inboxMode: 'push',
      cursor: args.cursor === undefined ? connection.cursor : args.cursor,
      lastCheckedAt: Date.now(),
      error: undefined,
    });
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
      if (inserted.length) await classifyNewItems(ctx, connection);
      if (connection.inboxMode !== 'push')
        await ctx.db.patch(connection._id, { inboxMode: 'push', lastCheckedAt: Date.now() });
    }
    return { delivered };
  },
});
