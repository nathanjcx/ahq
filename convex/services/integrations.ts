import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import { assertApprovedServerUrl, grantableTools } from '../registry';
import { provider } from '../schema';
import { requireService } from '../shared';
import { privateConnection, workspaceForActor } from './context';

export const connectIntegration = mutation({
  args: {
    secret: v.string(),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
    provider,
    name: v.string(),
    account: v.string(),
    ownerName: v.string(),
    serverUrl: v.string(),
    tools: v.array(v.string()),
    toolAnnotations: v.optional(
      v.array(
        v.object({
          name: v.string(),
          readOnlyHint: v.optional(v.boolean()),
          destructiveHint: v.optional(v.boolean()),
          idempotentHint: v.optional(v.boolean()),
        }),
      ),
    ),
    credentialCiphertext: v.string(),
    credentialKeyVersion: v.string(),
    inboxRelaySecretCiphertext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    if (!workspace) throw new Error('Workspace not found');
    await assertApprovedServerUrl(ctx, args.provider, args.serverUrl);
    if (!args.credentialCiphertext || args.credentialCiphertext.length > 100_000)
      throw new Error('Encrypted credential is missing or too large');
    const tools = [...new Set(args.tools)];
    // OAuth consent grants account scopes. Tool grants come from the administrator's reviewed registry.
    const allowedTools = await grantableTools(ctx, args.provider, tools);
    if (!allowedTools.length)
      throw new Error('None of the tools on this server are in the reviewed tool registry yet.');
    const owned = await ctx.db
      .query('connections')
      .withIndex('by_owner', (q) => q.eq('ownerSubject', args.authSubject))
      .collect();
    const existing = owned.find(
      (connection) =>
        connection.workspaceId === workspace._id &&
        connection.provider === args.provider &&
        connection.serverUrl === args.serverUrl &&
        connection.account === args.account,
    );
    const values = {
      workspaceId: workspace._id,
      ownerSubject: args.authSubject,
      ownerName: args.ownerName,
      provider: args.provider,
      name: args.name,
      account: args.account,
      status: 'connected' as const,
      tools,
      toolAnnotations: args.toolAnnotations,
      allowedTools,
      serverUrl: args.serverUrl,
      credentialCiphertext: args.credentialCiphertext,
      credentialKeyVersion: args.credentialKeyVersion,
      lastCheckedAt: Date.now(),
      error: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...values,
        inboxRelaySecretCiphertext: args.inboxRelaySecretCiphertext ?? existing.inboxRelaySecretCiphertext,
      });
      return { connectionId: existing._id };
    }
    const connectionId = await ctx.db.insert('connections', {
      ...values,
      visibility: 'private',
      visibleToSubjects: [],
      inboxRelaySecretCiphertext: args.inboxRelaySecretCiphertext,
      resourceScope: '',
      inboxResources: [],
      inboxMode: 'on-demand',
      createdAt: Date.now(),
    });
    return { connectionId };
  },
});

export const markConnectionError = mutation({
  args: { secret: v.string(), connectionId: v.id('connections'), error: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== 'connected') return null;
    await ctx.db.patch(connection._id, {
      status: 'degraded',
      error: args.error.slice(0, 500),
      lastCheckedAt: Date.now(),
    });
    return null;
  },
});

export const refreshCredential = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id('connections'),
    credentialCiphertext: v.string(),
    credentialKeyVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === 'revoked') throw new Error('Connection not found');
    await ctx.db.patch(connection._id, {
      credentialCiphertext: args.credentialCiphertext,
      credentialKeyVersion: args.credentialKeyVersion || connection.credentialKeyVersion,
      lastCheckedAt: Date.now(),
      error: undefined,
    });
    return null;
  },
});

export const connectionContext = query({
  args: { secret: v.string(), connectionId: v.id('connections') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === 'revoked') throw new Error('Connection not found');
    return {
      connection: privateConnection(connection),
      inboxRelaySecretCiphertext: connection.inboxRelaySecretCiphertext,
      authorization: {
        workspaceId: connection.workspaceId,
        ownerSubject: connection.ownerSubject,
        visibility: connection.visibility,
        visibleToSubjects: connection.visibleToSubjects,
      },
    };
  },
});

/** The connection owner rotates its inbox relay secret; only the web service can seal it. */
export const setRelaySecret = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id('connections'),
    authSubject: v.string(),
    inboxRelaySecretCiphertext: v.string(),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.ownerSubject !== args.authSubject) throw new Error('Connection not found');
    await ctx.db.patch(connection._id, { inboxRelaySecretCiphertext: args.inboxRelaySecretCiphertext });
    return null;
  },
});
