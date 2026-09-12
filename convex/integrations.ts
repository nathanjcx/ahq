import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { grantableTools, providerReadiness } from './registry';
import { connectionVisibility } from './schema';
import { canSeeConnection, requireWorkspace } from './shared';

export const disconnect = mutation({
  args: { connectionId: v.id('connections') },
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.workspaceId !== workspace._id ||
      !canSeeConnection(connection, actor.subject)
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

export const readiness = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspace(ctx);
    return providerReadiness(ctx);
  },
});

const resourceId = /^[-A-Za-z0-9_:/@.]{1,200}$/;

function resourceIds(value: string, field: string) {
  const ids = [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length > 100 || ids.some((id) => !resourceId.test(id)))
    throw new Error(`${field} must be comma-separated exact provider IDs`);
  return ids;
}

export const updateAccess = mutation({
  args: {
    connectionId: v.id('connections'),
    allowedTools: v.array(v.string()),
    resourceScope: v.string(),
    inboxResources: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.workspaceId !== workspace._id || connection.ownerSubject !== actor.subject)
      throw new Error('Connection not found');
    if (connection.status !== 'connected') throw new Error('Connection is not active');
    const allowedTools = [...new Set(args.allowedTools)];
    const grantable = await grantableTools(ctx, connection.provider, connection.tools);
    if (allowedTools.some((tool) => !grantable.includes(tool)))
      throw new Error('An allowed tool is not available on this connection');
    await ctx.db.patch(connection._id, {
      allowedTools,
      resourceScope: resourceIds(args.resourceScope, 'Resource restrictions').join(','),
      inboxResources: resourceIds(args.inboxResources, 'Inbox resources'),
    });
    return null;
  },
});

/** Sharing a connection lets other members' tasks use it. Only the owner decides. */
export const setSharing = mutation({
  args: {
    connectionId: v.id('connections'),
    visibility: connectionVisibility,
    visibleToSubjects: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.workspaceId !== workspace._id || connection.ownerSubject !== actor.subject)
      throw new Error('Connection not found');
    const subjects = [
      ...new Set(args.visibleToSubjects.map((subject) => subject.trim()).filter(Boolean)),
    ].filter((subject) => subject !== connection.ownerSubject);
    if (subjects.length > 200 || subjects.some((subject) => subject.length > 200))
      throw new Error('Too many members shared with this connection');
    await ctx.db.patch(connection._id, {
      visibility: args.visibility,
      visibleToSubjects: args.visibility === 'members' ? subjects : [],
    });
    return null;
  },
});
