import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { cleanText, identity, requirePlatformAdmin, requireWorkspace } from './shared';

const provider = v.union(
  v.literal('linear'),
  v.literal('slack'),
  v.literal('github'),
  v.literal('salesforce'),
  v.literal('servicenow'),
  v.literal('google-workspace'),
  v.literal('canva'),
);
const model = v.union(
  v.literal('gpt-5.6-luna'),
  v.literal('gpt-5.6-terra'),
  v.literal('gpt-5.6-sol'),
  v.literal('gpt-6-astra'),
);
const capability = v.object({ provider, tools: v.array(v.string()), optional: v.boolean() });
const media = v.object({
  url: v.string(),
  type: v.union(v.literal('image'), v.literal('video')),
  alt: v.string(),
});
const skill = v.object({ name: v.string(), version: v.string(), sha256: v.string(), content: v.string() });
const providerIds = [
  'linear',
  'slack',
  'github',
  'salesforce',
  'servicenow',
  'google-workspace',
  'canva',
] as const;
type ProviderId = (typeof providerIds)[number];
type RegistryTool = { name: string; description: string; mode: 'read' | 'write' | 'blocked' };

function toolRegistry() {
  let raw: unknown;
  try {
    raw = JSON.parse(process.env.MCP_TOOL_REGISTRY_JSON || '{}');
  } catch {
    throw new Error('MCP_TOOL_REGISTRY_JSON is invalid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('MCP_TOOL_REGISTRY_JSON must be an object keyed by provider');
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!providerIds.includes(key as ProviderId))
      throw new Error(`MCP_TOOL_REGISTRY_JSON has an unknown provider: ${key}`);
  }
  return providerIds.map((providerId) => {
    const value = source[providerId];
    if (value === undefined) return { provider: providerId, configured: false, tools: [] as RegistryTool[] };
    if (!Array.isArray(value))
      throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId} must be an array`);
    if (value.length > 2_000) throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId} has too many tools`);
    const tools = value.map((item, index): RegistryTool => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}] is invalid`);
      const record = item as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== 'name' && key !== 'description' && key !== 'mode'))
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}] has an unknown field`);
      if (
        typeof record.name !== 'string' ||
        !record.name.trim() ||
        record.name !== record.name.trim() ||
        record.name.length > 200
      )
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}].name is invalid`);
      if (
        typeof record.description !== 'string' ||
        !record.description.trim() ||
        record.description !== record.description.trim() ||
        record.description.length > 2_000
      )
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}].description is invalid`);
      if (record.mode !== 'read' && record.mode !== 'write' && record.mode !== 'blocked')
        throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId}[${index}].mode is invalid`);
      return { name: record.name, description: record.description, mode: record.mode };
    });
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error(`MCP_TOOL_REGISTRY_JSON.${providerId} has duplicate tool names`);
    return { provider: providerId, configured: true, tools };
  });
}

function validateCapabilities(capabilities: Array<{ provider: ProviderId; tools: string[]; optional: boolean }>) {
  const registry = new Map(toolRegistry().map((entry) => [entry.provider, entry]));
  const seenProviders = new Set<ProviderId>();
  for (const capability of capabilities) {
    if (seenProviders.has(capability.provider))
      throw new Error(`Employee has duplicate ${capability.provider} capability entries`);
    seenProviders.add(capability.provider);
    if (!capability.tools.length) throw new Error(`${capability.provider} capability requires at least one tool`);
    if (new Set(capability.tools).size !== capability.tools.length)
      throw new Error(`${capability.provider} capability has duplicate tools`);
    const entry = registry.get(capability.provider);
    if (!entry?.configured)
      throw new Error(`${capability.provider} has no configured MCP tool registry`);
    const tools = new Map(entry.tools.map((tool) => [tool.name, tool]));
    for (const tool of capability.tools) {
      const registered = tools.get(tool);
      if (!registered) throw new Error(`${capability.provider}.${tool} is not in the MCP tool registry`);
      if (registered.mode === 'blocked') throw new Error(`${capability.provider}.${tool} is blocked`);
    }
  }
}
const draftFields = {
  name: v.string(),
  role: v.string(),
  description: v.string(),
  category: v.string(),
  strengths: v.array(v.string()),
  limitations: v.array(v.string()),
  capabilities: v.array(capability),
  model,
  color: v.string(),
  media: v.array(media),
  instructions: v.string(),
  skills: v.array(skill),
};

function publicListing(version: Doc<'employeeVersions'>) {
  return {
    id: version._id,
    versionId: version._id,
    name: version.name,
    role: version.role,
    description: version.description,
    category: version.category,
    strengths: version.strengths,
    limitations: version.limitations,
    capabilities: version.capabilities,
    model: version.model,
    color: version.color,
    media: version.media,
    publishedAt: version.publishedAt,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await identity(ctx);
    const versions = await ctx.db.query('employeeVersions').withIndex('by_published').order('desc').take(500);
    return versions
      .filter((version) => !version.retiredAt)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map(publicListing);
  },
});

export const hire = mutation({
  args: { versionId: v.id('employeeVersions') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.retiredAt) throw new Error('Employee version is unavailable');
    const existing = await ctx.db
      .query('installations')
      .withIndex('by_workspace_version', (q) =>
        q.eq('workspaceId', workspace._id).eq('versionId', args.versionId),
      )
      .unique();
    if (existing) return { employeeId: existing._id };
    const employeeId = await ctx.db.insert('installations', {
      workspaceId: workspace._id,
      versionId: args.versionId,
      hiredBy: actor.subject,
      status: 'blocked',
      createdAt: Date.now(),
    });
    return { employeeId };
  },
});

export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const drafts = await ctx.db.query('employeeDrafts').withIndex('by_updated').collect();
    return drafts
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((draft) => ({
        draftId: draft._id,
        name: draft.name,
        role: draft.role,
        description: draft.description,
        category: draft.category,
        strengths: draft.strengths,
        limitations: draft.limitations,
        capabilities: draft.capabilities,
        model: draft.model,
        color: draft.color,
        media: draft.media,
        instructions: draft.instructions,
        skills: draft.skills,
        updatedAt: draft.updatedAt,
      }));
  },
});

export const adminToolRegistry = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return toolRegistry();
  },
});

export const saveDraft = mutation({
  args: { draftId: v.optional(v.id('employeeDrafts')), ...draftFields },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const normalized = {
      name: cleanText(args.name, 'Name', 120),
      role: cleanText(args.role, 'Role', 120),
      description: cleanText(args.description, 'Description', 2_000),
      category: cleanText(args.category, 'Category', 80),
      strengths: args.strengths.map((item) => cleanText(item, 'Strength', 200)),
      limitations: args.limitations.map((item) => cleanText(item, 'Limitation', 300)),
      capabilities: args.capabilities,
      model: args.model,
      color: cleanText(args.color, 'Color', 40),
      media: args.media,
      instructions: cleanText(args.instructions, 'Instructions', 100_000),
      skills: args.skills,
      updatedAt: Date.now(),
    };
    if (args.media.length > 10) throw new Error('At most 10 media items are allowed');
    if (
      args.skills.length > 10 ||
      args.skills.reduce((size, item) => size + item.content.length, 0) > 600_000
    )
      throw new Error('Private skill package is too large');
    for (const item of args.skills) {
      cleanText(item.name, 'Skill name', 120);
      cleanText(item.version, 'Skill version', 80);
      cleanText(item.sha256, 'Skill digest', 128);
    }
    if (args.draftId) {
      const draft = await ctx.db.get(args.draftId);
      if (!draft) throw new Error('Draft not found');
      await ctx.db.patch(args.draftId, normalized);
      return { draftId: args.draftId };
    }
    const draftId = await ctx.db.insert('employeeDrafts', { createdBy: actor.subject, ...normalized });
    return { draftId };
  },
});

export const publish = mutation({
  args: { draftId: v.id('employeeDrafts') },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error('Draft not found');
    validateCapabilities(draft.capabilities);
    const prior = await ctx.db
      .query('employeeVersions')
      .withIndex('by_draft', (q) => q.eq('draftId', args.draftId))
      .collect();
    const versionId = await ctx.db.insert('employeeVersions', {
      draftId: args.draftId,
      version: prior.length + 1,
      name: draft.name,
      role: draft.role,
      description: draft.description,
      category: draft.category,
      strengths: draft.strengths,
      limitations: draft.limitations,
      capabilities: draft.capabilities,
      model: draft.model,
      color: draft.color,
      media: draft.media,
      instructions: draft.instructions,
      skills: draft.skills,
      publishedBy: actor.subject,
      publishedAt: Date.now(),
    });
    return { versionId };
  },
});

export const retire = mutation({
  args: { versionId: v.id('employeeVersions') },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error('Employee version not found');
    if (!version.retiredAt) await ctx.db.patch(args.versionId, { retiredAt: Date.now() });
    return null;
  },
});
