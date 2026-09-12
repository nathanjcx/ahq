import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { canSeeConnection, requireWorkspace } from './shared';

function publicConnection(connection: Doc<'connections'>) {
  return {
    id: connection._id,
    provider: connection.provider,
    name: connection.name,
    account: connection.account,
    status: connection.status,
    tools: connection.tools,
    allowedTools: connection.allowedTools,
    resourceScope: connection.resourceScope,
    lastCheckedAt: connection.lastCheckedAt,
    inboxMode: connection.inboxMode,
    error: connection.error,
  };
}

export const connectionForServer = query({
  args: {},
  handler: async (ctx) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const connections = await ctx.db
      .query('connections')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    return connections
      .filter((connection) => canSeeConnection(connection, actor.subject, role))
      .map(publicConnection);
  },
});

export const disconnect = mutation({
  args: { connectionId: v.id('connections') },
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.workspaceId !== workspace._id ||
      !canSeeConnection(connection, actor.subject, role)
    )
      throw new Error('Connection not found');
    if (role !== 'owner' && role !== 'admin' && connection.ownerSubject !== actor.subject)
      throw new Error('Only the connection owner can disconnect it');
    await ctx.db.patch(connection._id, {
      status: 'revoked',
      credentialCiphertext: '',
      error: undefined,
      lastCheckedAt: Date.now(),
    });
    return null;
  },
});

export const setTools = mutation({
  args: {
    connectionId: v.id('connections'),
    allowedTools: v.array(v.string()),
    resourceScope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.workspaceId !== workspace._id || connection.ownerSubject !== actor.subject)
      throw new Error('Connection not found');
    if (connection.status !== 'connected') throw new Error('Connection is not active');
    const allowedTools = [...new Set(args.allowedTools)];
    if (allowedTools.some((tool) => !connection.tools.includes(tool)))
      throw new Error('An allowed tool was not discovered on this connection');
    await ctx.db.patch(connection._id, {
      allowedTools,
      resourceScope: args.resourceScope === undefined ? connection.resourceScope : args.resourceScope.trim(),
    });
    return null;
  },
});
