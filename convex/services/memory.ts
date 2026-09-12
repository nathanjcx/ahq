import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import {
  activeEntries,
  cleanClaim,
  cleanConfidence,
  cleanTags,
  expireStatus,
  memoryBudgets,
  memoryView,
  publicMemory,
  scopeBudget,
  scopeEntries,
  supersede,
  tokenEstimate,
} from '../lib/memory';
import { memoryKind, memoryScope } from '../schema';
import { cleanText, requireService, type Ctx } from '../shared';
import { taskForRunToken } from './context';

const RECALL_LIMIT = 20;
const CURATION_LIMIT = 200;
const JANITOR_NAME = 'The Janitor';

/** The scopes one task may read: its workspace, floor, project, employee notebook, and itself. */
function readableScopes(task: Doc<'tasks'>) {
  const scopes: { scope: 'workspace' | 'floor' | 'project' | 'agent' | 'task'; scopeId: string }[] = [
    { scope: 'workspace', scopeId: task.workspaceId },
    { scope: 'agent', scopeId: task.employeeId },
    { scope: 'task', scopeId: task._id },
  ];
  if (task.floorId) scopes.push({ scope: 'floor', scopeId: task.floorId });
  if (task.projectId) scopes.push({ scope: 'project', scopeId: task.projectId });
  return scopes;
}

/**
 * Everything the injection compiler needs for one shift: the active claims of every scope the task
 * reads, the floor's recent task summaries, and the workspace budgets. Marking use is a separate
 * mutation so this stays a pure read.
 */
export const compileInputs = query({
  args: { secret: v.string(), taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const now = Date.now();
    const scoped = async (scope: 'workspace' | 'floor' | 'project' | 'agent', scopeId: string | undefined) =>
      scopeId
        ? (await activeEntries(ctx, task.workspaceId, scope, scopeId, now)).map((e) => publicMemory(e, now))
        : [];
    const [workspace, floor, project, agent, budgets] = await Promise.all([
      scoped('workspace', task.workspaceId),
      scoped('floor', task.floorId),
      scoped('project', task.projectId),
      scoped('agent', task.employeeId),
      memoryBudgets(ctx, task.workspaceId),
    ]);
    const floorId = task.floorId;
    const recent = floorId
      ? await ctx.db
          .query('taskSummaries')
          .withIndex('by_floor', (q) => q.eq('floorId', floorId))
          .order('desc')
          .take(5)
      : [];
    return {
      taskId: task._id,
      workspaceId: task.workspaceId,
      floorId: task.floorId,
      projectId: task.projectId,
      employeeId: task.employeeId,
      budgets,
      entries: { workspace, floor, project, agent },
      summaries: recent.map(publicSummary),
    };
  },
});

function publicSummary(summary: Doc<'taskSummaries'>) {
  return {
    id: summary._id,
    taskId: summary.taskId,
    outcome: summary.outcome,
    decisions: summary.decisions,
    openQuestions: summary.openQuestions,
    artifactIds: summary.artifactIds,
    text: summary.text,
    inferred: summary.inferred,
    createdAt: summary.createdAt,
  };
}

/** Records that the compiled claims were read, which is what the agent budget evicts on. */
export const touch = mutation({
  args: { secret: v.string(), ids: v.array(v.id('memories')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const now = Date.now();
    for (const id of args.ids.slice(0, 500)) {
      const entry = await ctx.db.get(id);
      if (entry) await ctx.db.patch(entry._id, { lastUsedAt: now });
    }
    return null;
  },
});

/**
 * An employee files a claim. Its own notebook activates inside the agent budget, evicting the least
 * recently used notes; floor and project claims wait for curation or a person.
 */
export const remember = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    scope: v.union(v.literal('self'), v.literal('floor'), v.literal('project')),
    kind: memoryKind,
    text: v.string(),
    tags: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    supersedesId: v.optional(v.id('memories')),
  },
  returns: v.object({
    memoryId: v.id('memories'),
    status: v.union(v.literal('active'), v.literal('proposed')),
  }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    if (args.scope === 'floor' && !task.floorId) throw new Error('This task is not on a floor');
    if (args.scope === 'project' && !task.projectId) throw new Error('This task is not on a project');
    const scope = args.scope === 'self' ? 'agent' : args.scope;
    const scopeId =
      args.scope === 'self'
        ? String(task.employeeId)
        : String(args.scope === 'floor' ? task.floorId : task.projectId);
    const status = scope === 'agent' ? ('active' as const) : ('proposed' as const);
    const now = Date.now();
    const memoryId = await ctx.db.insert('memories', {
      workspaceId: task.workspaceId,
      scope,
      scopeId,
      kind: args.kind,
      text: cleanClaim(args.text),
      tags: cleanTags(args.tags),
      sourceTaskId: task._id,
      author: 'agent',
      authorName: task.employeeName,
      confidence: cleanConfidence(args.confidence),
      status,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (args.supersedesId) {
      const previous = await ctx.db.get(args.supersedesId);
      if (!previous || previous.workspaceId !== task.workspaceId || previous.scopeId !== scopeId)
        throw new Error('The superseded claim is not in this scope');
      await supersede(ctx, previous._id, memoryId);
    }
    if (scope === 'agent') await enforceAgentBudget(ctx, task, memoryId);
    return { memoryId, status };
  },
});

/** Keeps a notebook inside its budget by archiving the least recently used notes first. */
async function enforceAgentBudget(ctx: MutationCtx, task: Doc<'tasks'>, keepId: Id<'memories'>) {
  const budget = scopeBudget(await memoryBudgets(ctx, task.workspaceId), 'agent');
  const entries = await activeEntries(ctx, task.workspaceId, 'agent', String(task.employeeId));
  let total = entries.reduce((sum, entry) => sum + tokenEstimate(entry.text), 0);
  const evictable = entries
    .filter((entry) => entry._id !== keepId)
    .sort((a, b) => (a.lastUsedAt ?? a.createdAt) - (b.lastUsedAt ?? b.createdAt));
  for (const entry of evictable) {
    if (total <= budget) break;
    await ctx.db.patch(entry._id, { status: 'archived', updatedAt: Date.now() });
    total -= tokenEstimate(entry.text);
  }
}

/** Tag and keyword search over the scopes this task reads, best matches first. */
export const recall = query({
  args: {
    secret: v.string(),
    runToken: v.string(),
    query: v.string(),
    scope: v.optional(memoryScope),
  },
  returns: v.array(memoryView),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await taskForRunToken(ctx, args.runToken);
    const terms = searchTerms(args.query);
    if (!terms.length) return [];
    const now = Date.now();
    const scopes = readableScopes(task).filter((entry) => !args.scope || entry.scope === args.scope);
    const found: { entry: Doc<'memories'>; tags: number; hits: number }[] = [];
    for (const { scope, scopeId } of scopes) {
      const entries = await scopeEntries(ctx, task.workspaceId, scope, scopeId);
      for (const entry of entries) {
        const status = expireStatus(entry, now);
        if (status !== 'active' && status !== 'archived') continue;
        const tags = terms.filter((term) => entry.tags.some((tag) => tag.includes(term))).length;
        const text = entry.text.toLowerCase();
        const hits = terms.filter((term) => text.includes(term)).length;
        if (tags || hits) found.push({ entry, tags, hits });
      }
    }
    return found
      .sort((a, b) => b.tags - a.tags || b.hits - a.hits || b.entry.createdAt - a.entry.createdAt)
      .slice(0, RECALL_LIMIT)
      .map((match) => publicMemory(match.entry, now));
  },
});

function searchTerms(query: string) {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 12);
}

/** The structured outcome of a finished task. One summary per task, rewritten if it is filed again. */
export const recordSummary = mutation({
  args: {
    secret: v.string(),
    taskId: v.id('tasks'),
    outcome: v.string(),
    decisions: v.array(v.string()),
    openQuestions: v.array(v.string()),
    artifactIds: v.array(v.id('artifacts')),
    text: v.string(),
    inferred: v.boolean(),
  },
  returns: v.object({ summaryId: v.id('taskSummaries') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const lines = (values: string[], field: string) =>
      values.slice(0, 20).map((value) => cleanText(value, field, 400));
    const fields = {
      outcome: cleanText(args.outcome, 'Outcome', 400),
      decisions: lines(args.decisions, 'Decision'),
      openQuestions: lines(args.openQuestions, 'Open question'),
      artifactIds: args.artifactIds,
      text: cleanText(args.text, 'Summary', 5_000),
      inferred: args.inferred,
    };
    const existing = await ctx.db
      .query('taskSummaries')
      .withIndex('by_task', (q) => q.eq('taskId', task._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { summaryId: existing._id };
    }
    const summaryId = await ctx.db.insert('taskSummaries', {
      workspaceId: task.workspaceId,
      taskId: task._id,
      floorId: task.floorId,
      ...fields,
      createdAt: Date.now(),
    });
    return { summaryId };
  },
});

/** Janitor work runs under a janitor instance's own run token and only inside its workspace. */
async function janitorRun(ctx: Ctx, runToken: string, workspaceId?: Id<'workspaces'>) {
  const task = await taskForRunToken(ctx, runToken);
  const employee = await ctx.db.get(task.employeeId);
  if (!employee || employee.kind !== 'janitor') throw new Error('Janitor access required');
  if (workspaceId && workspaceId !== task.workspaceId) throw new Error('Janitor access required');
  return task;
}

async function janitorEntry(ctx: MutationCtx, task: Doc<'tasks'>, id: Id<'memories'>) {
  const entry = await ctx.db.get(id);
  if (!entry || entry.workspaceId !== task.workspaceId) throw new Error('Memory not found');
  return entry;
}

/** What a curation turn reads: the fill of every scope, plus the claims waiting on a decision. */
export const curateInputs = query({
  args: { secret: v.string(), runToken: v.string(), workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    await janitorRun(ctx, args.runToken, args.workspaceId);
    const now = Date.now();
    const budgets = await memoryBudgets(ctx, args.workspaceId);
    const rows = await ctx.db
      .query('memories')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', args.workspaceId))
      .collect();
    const live = rows
      .map((entry) => ({ entry, status: expireStatus(entry, now) }))
      .filter((row) => row.status !== 'archived');
    const fill = new Map<string, { scope: Doc<'memories'>['scope']; scopeId: string; tokens: number }>();
    for (const { entry, status } of live) {
      if (status !== 'active') continue;
      const key = `${entry.scope}:${entry.scopeId}`;
      const current = fill.get(key) ?? { scope: entry.scope, scopeId: entry.scopeId, tokens: 0 };
      current.tokens += tokenEstimate(entry.text);
      fill.set(key, current);
    }
    return {
      budgets,
      scopes: [...fill.values()].map((scope) => ({ ...scope, budget: scopeBudget(budgets, scope.scope) })),
      // Claims waiting on a decision come first: they are what a curation turn is for.
      entries: live
        .sort(
          (a, b) =>
            Number(a.status === 'active') - Number(b.status === 'active') ||
            b.entry.createdAt - a.entry.createdAt,
        )
        .slice(0, CURATION_LIMIT)
        .map(({ entry }) => publicMemory(entry, now)),
    };
  },
});

/** Replaces several overlapping claims with one. Each input is archived pointing at the merge. */
export const merge = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    ids: v.array(v.id('memories')),
    text: v.string(),
    kind: memoryKind,
    tags: v.array(v.string()),
  },
  returns: v.object({ memoryId: v.id('memories') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await janitorRun(ctx, args.runToken);
    if (args.ids.length < 2) throw new Error('A merge needs at least two claims');
    const inputs = await Promise.all(args.ids.map((id) => janitorEntry(ctx, task, id)));
    const [first] = inputs;
    if (inputs.some((entry) => entry.scope !== first.scope || entry.scopeId !== first.scopeId))
      throw new Error('A merge stays inside one scope');
    const now = Date.now();
    const memoryId = await ctx.db.insert('memories', {
      workspaceId: task.workspaceId,
      scope: first.scope,
      scopeId: first.scopeId,
      kind: args.kind,
      text: cleanClaim(args.text),
      tags: cleanTags(args.tags),
      author: 'janitor',
      authorName: task.employeeName,
      confidence: Math.max(...inputs.map((entry) => entry.confidence)),
      status: 'active',
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (const entry of inputs) await supersede(ctx, entry._id, memoryId);
    return { memoryId };
  },
});

/**
 * Marks a claim as contested so it reaches no model. Naming the competing claim contests both sides
 * and links them, which is what lets a person resolve the conflict in one decision. The caller posts
 * the channel question, so the contested entry is returned.
 */
export const contest = mutation({
  args: {
    secret: v.string(),
    runToken: v.string(),
    id: v.id('memories'),
    reason: v.string(),
    otherId: v.optional(v.id('memories')),
  },
  returns: memoryView,
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await janitorRun(ctx, args.runToken);
    const entry = await janitorEntry(ctx, task, args.id);
    const reason = cleanText(args.reason, 'Reason', 400);
    const now = Date.now();
    const other = args.otherId ? await janitorEntry(ctx, task, args.otherId) : null;
    if (other) {
      if (other._id === entry._id) throw new Error('A claim cannot be contested against itself');
      if (other.scope !== entry.scope || other.scopeId !== entry.scopeId)
        throw new Error('A conflict stays inside one scope');
      await ctx.db.patch(other._id, {
        status: 'contested',
        contestReason: reason,
        contestedWithId: entry._id,
        updatedAt: now,
      });
    }
    const patch = {
      status: 'contested' as const,
      contestReason: reason,
      contestedWithId: other?._id,
      updatedAt: now,
    };
    await ctx.db.patch(entry._id, patch);
    return publicMemory({ ...entry, ...patch });
  },
});

/** Retires a claim the janitor judged stale or wrong. */
export const archive = mutation({
  args: { secret: v.string(), runToken: v.string(), id: v.id('memories') },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await janitorRun(ctx, args.runToken);
    const entry = await janitorEntry(ctx, task, args.id);
    await ctx.db.patch(entry._id, { status: 'archived', updatedAt: Date.now() });
    return null;
  },
});

/** Proposes a scoped claim for the whole workspace. An administrator approves it in `memory:approve`. */
export const promote = mutation({
  args: { secret: v.string(), runToken: v.string(), id: v.id('memories') },
  returns: v.object({ memoryId: v.id('memories') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const task = await janitorRun(ctx, args.runToken);
    const source = await janitorEntry(ctx, task, args.id);
    if (source.scope === 'workspace') throw new Error('That claim is already a workspace claim');
    if (source.status !== 'active') throw new Error('Only an active claim can be promoted');
    const now = Date.now();
    const memoryId = await ctx.db.insert('memories', {
      workspaceId: task.workspaceId,
      scope: 'workspace',
      scopeId: task.workspaceId,
      kind: source.kind,
      text: source.text,
      tags: source.tags,
      sourceTaskId: source.sourceTaskId,
      author: 'janitor',
      authorName: task.employeeName,
      confidence: source.confidence,
      status: 'proposed',
      sourceMemoryId: source._id,
      createdAt: now,
      updatedAt: now,
    });
    return { memoryId };
  },
});

/** The workspace's janitor instance, or null when it has not been created yet. */
export const janitorFor = query({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  returns: v.union(v.object({ employeeId: v.id('installations'), name: v.string() }), v.null()),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const janitor = await findJanitor(ctx, args.workspaceId);
    return janitor ? { employeeId: janitor._id, name: janitor.name ?? JANITOR_NAME } : null;
  },
});

async function findJanitor(ctx: Ctx, workspaceId: Id<'workspaces'>) {
  const installations = await ctx.db
    .query('installations')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .collect();
  return installations.find((installation) => installation.kind === 'janitor') ?? null;
}

/** Creates the workspace's one janitor on a reserved employee version. Safe to call repeatedly. */
export const ensureJanitor = mutation({
  args: { secret: v.string(), workspaceId: v.id('workspaces') },
  returns: v.object({ employeeId: v.id('installations') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const existing = await findJanitor(ctx, workspace._id);
    if (existing) return { employeeId: existing._id };
    const versionId = await reservedJanitorVersion(ctx);
    const employeeId = await ctx.db.insert('installations', {
      workspaceId: workspace._id,
      versionId,
      hiredBy: 'system',
      status: 'ready',
      name: JANITOR_NAME,
      kind: 'janitor',
      createdAt: Date.now(),
    });
    return { employeeId };
  },
});

/** The single reserved janitor version every workspace's janitor runs, created on first use. */
async function reservedJanitorVersion(ctx: MutationCtx) {
  const drafts = await ctx.db.query('employeeDrafts').withIndex('by_updated').collect();
  const reserved = drafts.find((draft) => draft.createdBy === 'system' && draft.name === JANITOR_NAME);
  if (reserved) {
    const version = await ctx.db
      .query('employeeVersions')
      .withIndex('by_draft', (q) => q.eq('draftId', reserved._id))
      .first();
    if (version) return version._id;
  }
  const now = Date.now();
  const profile = {
    name: JANITOR_NAME,
    role: 'Records keeper',
    description: 'Curates the workspace memory: merges, contests, archives, and promotes claims.',
    category: 'Operations',
    strengths: ['Keeps claims atomic and current'],
    limitations: ['Memory tools only; never does project work'],
    capabilities: [],
    model: 'gpt-5.6-terra' as const,
    color: '#5b6472',
    media: [],
    instructions:
      'You keep this workspace’s memory. Merge claims that say the same thing, contest claims that conflict, archive claims that are stale, and propose claims that hold for the whole workspace. Change nothing outside memory.',
    skills: [],
    persona: { voice: 'Terse and methodical.', traits: ['terse', 'methodical'] },
  };
  const draftId =
    reserved?._id ??
    (await ctx.db.insert('employeeDrafts', { createdBy: 'system', ...profile, updatedAt: now }));
  return ctx.db.insert('employeeVersions', {
    draftId,
    version: 1,
    ...profile,
    publishedBy: 'system',
    publishedAt: now,
  });
}
