import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ProviderId } from '../../lib/contracts';
import type { ProviderRuntimeConfig } from '../../services/types';
import { policiesFor, providerConfigFor, providerIds, registryToolsFor } from '../registry';
import { provider } from '../schema';
import { requireService } from '../shared';

/** Everything web, worker, and gateway need to reach a provider, including sealed secrets. */
export const providers = query({
  args: { secret: v.string() },
  handler: async (ctx, args): Promise<ProviderRuntimeConfig[]> => {
    requireService(args.secret);
    const configs: ProviderRuntimeConfig[] = [];
    for (const id of providerIds) {
      const config = await providerConfigFor(ctx, id);
      const tools = await registryToolsFor(ctx, id);
      configs.push({
        provider: id,
        enabledUrls: config?.enabledUrls ?? [],
        oauthClients: config?.oauthClients ?? [],
        inboxSecretCiphertext: config?.inboxSecretCiphertext,
        reviewedTools: tools.filter((tool) => tool.mode !== 'blocked').length,
      });
    }
    return configs;
  },
});

export const policies = query({
  args: { secret: v.string(), providers: v.array(provider) },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return policiesFor(ctx, args.providers);
  },
});

type Upsert = { oauthClients?: Doc<'providerConfigs'>['oauthClients']; inboxSecretCiphertext?: string };

async function upsertConfig(ctx: MutationCtx, providerId: ProviderId, actorSubject: string, values: Upsert) {
  const existing = await providerConfigFor(ctx, providerId);
  const now = Date.now();
  if (existing) await ctx.db.patch(existing._id, { ...values, updatedBy: actorSubject, updatedAt: now });
  else
    await ctx.db.insert('providerConfigs', {
      provider: providerId,
      enabledUrls: [],
      oauthClients: [],
      ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
      updatedBy: actorSubject,
      updatedAt: now,
    });
  return null;
}

export const setOAuthClient = mutation({
  args: {
    secret: v.string(),
    actorSubject: v.string(),
    provider,
    serverUrl: v.optional(v.string()),
    clientId: v.string(),
    clientSecretCiphertext: v.optional(v.string()),
    scopes: v.optional(v.string()),
    authorizationUrl: v.optional(v.string()),
    tokenUrl: v.optional(v.string()),
    tokenAuthMethod: v.optional(
      v.union(v.literal('client_secret_basic'), v.literal('client_secret_post'), v.literal('none')),
    ),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const clientId = args.clientId.trim();
    if (!clientId) throw new Error('Client id is required');
    const clients = (await providerConfigFor(ctx, args.provider))?.oauthClients ?? [];
    const previous = clients.find((client) => client.serverUrl === args.serverUrl);
    const client = {
      serverUrl: args.serverUrl,
      clientId,
      clientSecretCiphertext: args.clientSecretCiphertext ?? previous?.clientSecretCiphertext,
      scopes: args.scopes,
      authorizationUrl: args.authorizationUrl,
      tokenUrl: args.tokenUrl,
      tokenAuthMethod: args.tokenAuthMethod,
    };
    return upsertConfig(ctx, args.provider, args.actorSubject, {
      oauthClients: [...clients.filter((entry) => entry.serverUrl !== args.serverUrl), client],
    });
  },
});

export const removeOAuthClient = mutation({
  args: { secret: v.string(), actorSubject: v.string(), provider, serverUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const existing = await providerConfigFor(ctx, args.provider);
    if (!existing) return null;
    return upsertConfig(ctx, args.provider, args.actorSubject, {
      oauthClients: existing.oauthClients.filter((client) => client.serverUrl !== args.serverUrl),
    });
  },
});

export const setInboxSecret = mutation({
  args: {
    secret: v.string(),
    actorSubject: v.string(),
    provider,
    inboxSecretCiphertext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    return upsertConfig(ctx, args.provider, args.actorSubject, {
      inboxSecretCiphertext: args.inboxSecretCiphertext,
    });
  },
});
