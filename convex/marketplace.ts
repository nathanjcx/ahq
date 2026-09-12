import { v } from 'convex/values';
import type { Persona, ProviderId, TaskStatus } from '../lib/contracts';
import { MEMORY_PLACEHOLDER, WORKER_ROLE_RULES, composeInstructions } from '../lib/instructions';
import { PERSONA_LIMITS, isPersonaTrait } from '../lib/personas';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import {
  VERSION_FIELDS,
  addToFloor,
  changedFields,
  createInstances,
  instanceNames,
  listingForDraft,
  nameStem,
  namesOnFloor,
  removeFromFloor,
  renderField,
  requireInstance,
} from './lib/marketplace';
import { isReservedVersion } from './lib/reserved';
import { settingsFor } from './lib/schedule';
import { assertEmployeeReady, requireFloor } from './lib/tasks';
import { registryToolsFor } from './registry';
import { listingVisibility, persona as personaValidator } from './schema';
import { cleanText, identity, requirePlatformAdmin, requireWorkspace, sha256, type Ctx } from './shared';

const provider = v.union(
  v.literal('linear'),
  v.literal('slack'),
  v.literal('github'),
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
async function validateCapabilities(
  ctx: Ctx,
  capabilities: Array<{ provider: ProviderId; tools: string[]; optional: boolean }>,
) {
  const seenProviders = new Set<ProviderId>();
  for (const capability of capabilities) {
    if (seenProviders.has(capability.provider))
      throw new Error(`Employee has duplicate ${capability.provider} capability entries`);
    seenProviders.add(capability.provider);
    if (!capability.tools.length)
      throw new Error(`${capability.provider} capability requires at least one tool`);
    if (new Set(capability.tools).size !== capability.tools.length)
      throw new Error(`${capability.provider} capability has duplicate tools`);
    const tools = new Map(
      (await registryToolsFor(ctx, capability.provider)).map((tool) => [tool.name, tool]),
    );
    for (const tool of capability.tools) {
      const registered = tools.get(tool);
      if (!registered) throw new Error(`${capability.provider}.${tool} is not in the MCP tool registry`);
      if (registered.mode === 'blocked') throw new Error(`${capability.provider}.${tool} is blocked`);
    }
  }
}

function validateMedia(items: Array<{ url: string; type: 'image' | 'video'; alt: string }>) {
  for (const item of items) {
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      throw new Error('Marketplace media URL is invalid');
    }
    if (url.protocol !== 'https:' || url.username || url.password || item.url.length > 2_000)
      throw new Error('Marketplace media must use HTTPS without embedded credentials');
    cleanText(item.alt, 'Marketplace media alt text', 500);
  }
}
/** Evidence links are public references, held to the same rule as marketplace media. */
function evidenceLink(value: string) {
  const link = cleanText(value, 'Evidence link', 2_000);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error('Evidence link is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Evidence link must use HTTPS without embedded credentials');
  return link;
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
  persona: v.optional(personaValidator),
};

/** Character, within fixed limits: a persona is never a place to smuggle instructions. */
function normalizePersona(value: Persona | undefined): Persona | undefined {
  if (!value || (!value.voice.trim() && !value.traits.length && !value.catchphrase?.trim())) return undefined;
  const voice = cleanText(value.voice, 'Persona voice', PERSONA_LIMITS.voice);
  if (value.traits.length > PERSONA_LIMITS.traits)
    throw new Error(`A persona has at most ${PERSONA_LIMITS.traits} traits`);
  const traits = value.traits.map((trait) => {
    if (!isPersonaTrait(trait)) throw new Error(`"${trait}" is not a persona trait`);
    return trait;
  });
  if (new Set(traits).size !== traits.length) throw new Error('A persona has duplicate traits');
  const catchphrase = value.catchphrase?.trim()
    ? cleanText(value.catchphrase, 'Persona catchphrase', PERSONA_LIMITS.catchphrase)
    : undefined;
  return { voice, traits, ...(catchphrase ? { catchphrase } : {}) };
}

function publicListing(listing: Doc<'listings'>, version: Doc<'employeeVersions'>) {
  return {
    id: version._id,
    listingId: listing._id,
    versionId: version._id,
    currentVersion: version.version,
    visibility: listing.visibility,
    evidence: listing.evidence,
    hires: listing.hires,
    completedTasks: listing.completedTasks,
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
    persona: version.persona,
    publishedAt: version.publishedAt,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await identity(ctx);
    const listings = await ctx.db
      .query('listings')
      .withIndex('by_visibility', (q) => q.eq('visibility', 'published'))
      .collect();
    const rows = await Promise.all(
      listings.map(async (listing) => {
        const version = await ctx.db.get(listing.currentVersionId);
        // Reserved employees are made by a workspace for itself and are never hired from here.
        if (!version || version.retiredAt || isReservedVersion(version)) return null;
        return publicListing(listing, version);
      }),
    );
    return rows.filter((row) => row !== null).sort((a, b) => b.publishedAt - a.publishedAt);
  },
});

/** Statuses a task still occupies its instance with; an instance in one of them cannot be retired. */
const ACTIVE_TASK_STATUSES: TaskStatus[] = ['queued', 'running', 'awaiting_approval', 'waiting', 'blocked'];

async function hirableListing(ctx: Ctx, listingId: Id<'listings'>) {
  const listing = await ctx.db.get(listingId);
  if (!listing || listing.visibility !== 'published') throw new Error('Listing is unavailable');
  return listing;
}

/**
 * Hiring under the workspace's policy. `anyone` hires; `admins` refuses members; `approval` files a
 * request for a member and hires straight away for an owner or admin, who is the one who decides it.
 */
export const hire = mutation({
  args: {
    listingId: v.id('listings'),
    floorId: v.optional(v.id('floors')),
    count: v.optional(v.number()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace, role, actor } = await requireWorkspace(ctx);
    const count = args.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 20)
      throw new Error('Hire between 1 and 20 instances at a time');
    const listing = await hirableListing(ctx, args.listingId);
    const { hiringPolicy } = await settingsFor(ctx, workspace._id);
    if (hiringPolicy !== 'anyone' && role === 'member') {
      if (hiringPolicy === 'admins')
        throw new Error('Only workspace owners and admins can hire in this workspace');
      // The floor is checked here too, so a request cannot sit pending on a floor that cannot take it.
      if (args.floorId) await requireFloor(ctx, workspace._id, args.floorId);
      const requestId = await ctx.db.insert('hireRequests', {
        workspaceId: workspace._id,
        listingId: listing._id,
        floorId: args.floorId,
        count,
        requestedBy: actor.subject,
        requestedByName: actor.name,
        status: 'pending',
        createdAt: Date.now(),
      });
      return { employeeIds: [], requestId };
    }
    const employeeIds = await createInstances(ctx, workspace, listing, actor.subject, {
      floorId: args.floorId,
      count,
      name: args.name,
    });
    return { employeeIds, requestId: undefined };
  },
});

export const hireRequests = query({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const requests = await ctx.db
      .query('hireRequests')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .order('desc')
      .take(100);
    return Promise.all(
      requests.map(async (request) => {
        const listing = await ctx.db.get(request.listingId);
        const version = listing ? await ctx.db.get(listing.currentVersionId) : null;
        return {
          id: request._id,
          listingId: request.listingId,
          listingName: version?.name ?? 'Retired listing',
          floorId: request.floorId,
          count: request.count,
          requestedBy: request.requestedBy,
          requestedByName: request.requestedByName,
          status: request.status,
          decidedBy: request.decidedBy,
          createdAt: request.createdAt,
        };
      }),
    );
  },
});

export const decideHire = mutation({
  args: { requestId: v.id('hireRequests'), approved: v.boolean() },
  handler: async (ctx, args) => {
    const { workspace, role, actor } = await requireWorkspace(ctx);
    if (role === 'member') throw new Error('Workspace owner or administrator access required');
    const request = await ctx.db.get(args.requestId);
    if (!request || request.workspaceId !== workspace._id) throw new Error('Hire request not found');
    if (request.status !== 'pending') throw new Error('Hire request is already decided');
    await ctx.db.patch(request._id, {
      status: args.approved ? 'approved' : 'declined',
      decidedBy: actor.subject,
    });
    if (!args.approved) return { employeeIds: [] };
    const listing = await hirableListing(ctx, request.listingId);
    // The instances belong to the member who asked for them, not to the administrator who approved.
    const employeeIds = await createInstances(ctx, workspace, listing, request.requestedBy, {
      floorId: request.floorId,
      count: request.count,
    });
    return { employeeIds };
  },
});

export const rename = mutation({
  args: { employeeId: v.id('installations'), name: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const installation = await requireInstance(ctx, workspace._id, args.employeeId);
    const name = cleanText(args.name, 'Employee name', 120);
    const taken = await namesOnFloor(ctx, workspace._id, installation.floorId, installation._id);
    if (taken.has(name)) throw new Error(`Another instance here is already called ${name}`);
    await ctx.db.patch(installation._id, { name });
    return { name };
  },
});

export const move = mutation({
  args: { employeeId: v.id('installations'), floorId: v.optional(v.id('floors')) },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const installation = await requireInstance(ctx, workspace._id, args.employeeId);
    const floor = args.floorId ? await requireFloor(ctx, workspace._id, args.floorId) : null;
    if (floor && floor.archivedAt !== undefined) throw new Error('Floor is archived');
    if (installation.floorId) await removeFromFloor(ctx, installation.floorId, installation._id);
    if (floor) await addToFloor(ctx, floor, [installation._id]);
    const version = await ctx.db.get(installation.versionId);
    const current = installation.name ?? version?.name ?? 'Employee';
    const taken = await namesOnFloor(ctx, workspace._id, args.floorId, installation._id);
    // A name that is already spoken for on the destination floor is numbered again from its stem.
    const name = taken.has(current) ? instanceNames(nameStem(current), taken, 1)[0] : current;
    await ctx.db.patch(installation._id, { floorId: args.floorId, name });
    return { floorId: args.floorId, name };
  },
});

export const retireInstance = mutation({
  args: { employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const installation = await requireInstance(ctx, workspace._id, args.employeeId);
    for (const status of ACTIVE_TASK_STATUSES) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id).eq('status', status))
        .collect();
      if (tasks.some((task) => task.employeeId === installation._id))
        throw new Error('Finish or cancel the active work on this instance before retiring it');
    }
    if (installation.floorId) await removeFromFloor(ctx, installation.floorId, installation._id);
    await ctx.db.patch(installation._id, { status: 'retired' });
    return null;
  },
});

/**
 * Re-pins an instance to its listing's current version. The patch lands before the readiness check,
 * so a version that needs a connection the workspace cannot reach rolls the whole mutation back.
 */
export const upgrade = mutation({
  args: { employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const installation = await requireInstance(ctx, workspace._id, args.employeeId);
    const listing = installation.listingId ? await ctx.db.get(installation.listingId) : null;
    if (!listing) throw new Error('This instance was not hired from a listing');
    const before = await ctx.db.get(installation.versionId);
    const after = await ctx.db.get(listing.currentVersionId);
    if (!before || !after || after.retiredAt) throw new Error('Employee version is unavailable');
    if (before._id === after._id) return { version: after.version, changed: [] };
    await ctx.db.patch(installation._id, { versionId: after._id });
    await assertEmployeeReady(ctx, workspace, actor.subject, installation._id);
    return { version: after.version, changed: changedFields(before, after) };
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
        persona: draft.persona,
        updatedAt: draft.updatedAt,
      }));
  },
});

export const saveDraft = mutation({
  args: { draftId: v.optional(v.id('employeeDrafts')), ...draftFields },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);
    if (args.media.length > 10) throw new Error('At most 10 media items are allowed');
    if (
      args.skills.length > 10 ||
      args.skills.reduce((size, item) => size + item.content.length, 0) > 600_000
    )
      throw new Error('Private skill package is too large');
    for (const item of args.skills) {
      cleanText(item.name, 'Skill name', 120);
      cleanText(item.version, 'Skill version', 80);
      if (!item.content.trim()) throw new Error('Skill content is required');
    }
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
      skills: await Promise.all(
        args.skills.map(async (item) => ({ ...item, sha256: await sha256(item.content) })),
      ),
      persona: normalizePersona(args.persona),
      updatedAt: Date.now(),
    };
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
    await validateCapabilities(ctx, draft.capabilities);
    validateMedia(draft.media);
    const skills = await Promise.all(
      draft.skills.map(async (item) => ({ ...item, sha256: await sha256(item.content) })),
    );
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
      skills,
      persona: draft.persona,
      publishedBy: actor.subject,
      publishedAt: Date.now(),
    });
    // One listing per draft: publishing again moves the offer forward without disturbing instances,
    // which stay on the version they were hired on until someone upgrades them.
    const now = Date.now();
    const listing = await listingForDraft(ctx, args.draftId);
    if (listing) await ctx.db.patch(listing._id, { currentVersionId: versionId, updatedAt: now });
    const listingId =
      listing?._id ??
      (await ctx.db.insert('listings', {
        draftId: args.draftId,
        currentVersionId: versionId,
        visibility: 'published',
        hires: 0,
        completedTasks: 0,
        updatedAt: now,
      }));
    return { versionId, listingId };
  },
});

export const setVisibility = mutation({
  args: { listingId: v.id('listings'), visibility: listingVisibility },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const listing = await ctx.db.get(args.listingId);
    if (!listing) throw new Error('Listing not found');
    await ctx.db.patch(listing._id, { visibility: args.visibility, updatedAt: Date.now() });
    return null;
  },
});

/** What this employee has actually done. Omitting `evidence` clears it. */
export const setEvidence = mutation({
  args: {
    listingId: v.id('listings'),
    evidence: v.optional(
      v.object({ sampleTask: v.string(), sampleOutput: v.string(), link: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const listing = await ctx.db.get(args.listingId);
    if (!listing) throw new Error('Listing not found');
    const evidence = args.evidence && {
      sampleTask: cleanText(args.evidence.sampleTask, 'Sample task', 2_000),
      sampleOutput: cleanText(args.evidence.sampleOutput, 'Sample output', 10_000),
      ...(args.evidence.link?.trim() ? { link: evidenceLink(args.evidence.link) } : {}),
    };
    await ctx.db.patch(listing._id, { evidence, updatedAt: Date.now() });
    return null;
  },
});

/** The instruction block a session would receive for this draft, for the studio to read. */
export const previewInstructions = query({
  args: { draftId: v.id('employeeDrafts') },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error('Draft not found');
    return composeInstructions({
      roleRules: WORKER_ROLE_RULES,
      memory: MEMORY_PLACEHOLDER,
      persona: draft.persona,
      instructions: draft.instructions,
    });
  },
});

/** What publishing this draft would change, field by field, against the version on offer today. */
export const versionDiff = query({
  args: { draftId: v.id('employeeDrafts') },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error('Draft not found');
    const listing = await listingForDraft(ctx, args.draftId);
    const current = listing ? await ctx.db.get(listing.currentVersionId) : null;
    const fields = (current ? changedFields(current, draft) : VERSION_FIELDS).map((field) => ({
      field,
      before: current ? renderField(current[field]) : '',
      after: renderField(draft[field]),
    }));
    return { currentVersion: current?.version, publishedAt: current?.publishedAt, fields };
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
