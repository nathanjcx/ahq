import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
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

function publicListing(version: any) {
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
      .filter((version: any) => !version.retiredAt)
      .sort((a: any, b: any) => b.publishedAt - a.publishedAt)
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
      .withIndex('by_workspace_version', (q: any) =>
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
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
      .map((draft: any) => ({
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
    const prior = await ctx.db
      .query('employeeVersions')
      .withIndex('by_draft', (q: any) => q.eq('draftId', args.draftId))
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
