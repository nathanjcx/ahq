import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getProvider, providerServerUrls } from '../lib/providers';
import {
  providerConfig,
  providerConfigFor,
  providerIds,
  registryTool,
  registryToolsFor,
  validateRegistryTool,
} from './registry';
import { correctionDescriptor, provider, toolMode } from './schema';
import { requirePlatformAdmin } from './shared';

// No `returns` validator on providerConfigs or registryTools: both restate whole configuration
// documents built in convex/registry.ts, and the contract test pins their shape.
export const providerConfigs = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const configs = [];
    for (const id of providerIds) configs.push(providerConfig(id, await providerConfigFor(ctx, id)));
    return configs;
  },
});

export const setEnabledUrls = mutation({
  args: { provider, enabledUrls: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const known = providerServerUrls(getProvider(args.provider));
    const enabledUrls = [...new Set(args.enabledUrls)];
    for (const url of enabledUrls) {
      if (!known.includes(url)) throw new Error(`${url} is not a registered ${args.provider} MCP server`);
    }
    const existing = await providerConfigFor(ctx, args.provider);
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { enabledUrls, updatedBy: actor.subject, updatedAt: now });
    else
      await ctx.db.insert('providerConfigs', {
        provider: args.provider,
        enabledUrls,
        oauthClients: [],
        updatedBy: actor.subject,
        updatedAt: now,
      });
    return null;
  },
});

export const registryTools = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const tools = [];
    for (const id of providerIds) tools.push(...(await registryToolsFor(ctx, id)).map(registryTool));
    return tools.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  },
});

export const saveRegistryTool = mutation({
  args: {
    provider,
    name: v.string(),
    description: v.string(),
    mode: toolMode,
    resourceArgument: v.optional(v.string()),
    correction: v.optional(correctionDescriptor),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const { name, description } = validateRegistryTool(args);
    const existing = await ctx.db
      .query('registryTools')
      .withIndex('by_provider_name', (q) => q.eq('provider', args.provider).eq('name', name))
      .unique();
    const values = {
      provider: args.provider,
      name,
      description,
      mode: args.mode,
      resourceArgument: args.resourceArgument?.trim(),
      correction: args.correction,
      updatedBy: actor.subject,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert('registryTools', values);
    return null;
  },
});

export const deleteRegistryTool = mutation({
  args: { provider, name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const existing = await ctx.db
      .query('registryTools')
      .withIndex('by_provider_name', (q) => q.eq('provider', args.provider).eq('name', args.name.trim()))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** Seeds the registry from tools discovered on the administrator's own connection, blocked until reviewed. */
export const importDiscoveredTools = mutation({
  args: { connectionId: v.id('connections') },
  returns: v.object({ imported: v.number() }),
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.ownerSubject !== actor.subject) throw new Error('Connection not found');
    const existing = new Set((await registryToolsFor(ctx, connection.provider)).map((tool) => tool.name));
    const annotations = new Map(
      (connection.toolAnnotations ?? []).map(({ name, ...hints }) => [name, hints]),
    );
    const now = Date.now();
    let imported = 0;
    for (const name of new Set(connection.tools)) {
      if (existing.has(name) || name.length > 200) continue;
      await ctx.db.insert('registryTools', {
        provider: connection.provider,
        name,
        description: '',
        mode: 'blocked',
        annotations: annotations.get(name),
        updatedBy: actor.subject,
        updatedAt: now,
      });
      existing.add(name);
      imported += 1;
    }
    return { imported };
  },
});
