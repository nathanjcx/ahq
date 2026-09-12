import { v } from 'convex/values';
import { defaultWorkspaceSettings, type MemoryBudgets, type MemoryScope } from '../../lib/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { memoryAuthor, memoryKind, memoryScope, memoryStatus } from '../schema';
import { cleanText, type Ctx } from '../shared';

/** One claim is one sentence: the limits keep a scope readable inside its token budget. */
export const MEMORY_LIMITS = { text: 400, tags: 5, tag: 24 } as const;

/** The shape every memory function returns; `Memory` in the UI contracts is its public name. */
export const memoryView = v.object({
  id: v.id('memories'),
  scope: memoryScope,
  scopeId: v.string(),
  kind: memoryKind,
  text: v.string(),
  tags: v.array(v.string()),
  sourceTaskId: v.optional(v.id('tasks')),
  author: memoryAuthor,
  authorName: v.string(),
  confidence: v.number(),
  status: memoryStatus,
  supersedesId: v.optional(v.id('memories')),
  sourceMemoryId: v.optional(v.id('memories')),
  contestReason: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** The one token estimate the whole product uses: four characters per token. */
export function tokenEstimate(text: string) {
  return Math.ceil(text.length / 4);
}

/** Expiry is applied when an entry is read, so a passed expiry needs no sweep to take effect. */
export function expireStatus(entry: Doc<'memories'>, now: number) {
  return entry.expiresAt !== undefined && entry.expiresAt <= now ? ('archived' as const) : entry.status;
}

/** One entry in the shape the interface and the compiler read, with expiry already applied. */
export function publicMemory(entry: Doc<'memories'>, now = Date.now()) {
  return {
    id: entry._id,
    scope: entry.scope,
    scopeId: entry.scopeId,
    kind: entry.kind,
    text: entry.text,
    tags: entry.tags,
    sourceTaskId: entry.sourceTaskId,
    author: entry.author,
    authorName: entry.authorName,
    confidence: entry.confidence,
    status: expireStatus(entry, now),
    supersedesId: entry.supersedesId,
    sourceMemoryId: entry.sourceMemoryId,
    contestReason: entry.contestReason,
    expiresAt: entry.expiresAt,
    lastUsedAt: entry.lastUsedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/** The active, unexpired claims of one scope. Proposed and contested claims never reach a model. */
export async function activeEntries(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  scope: MemoryScope,
  scopeId: string,
  now = Date.now(),
) {
  const entries = await ctx.db
    .query('memories')
    .withIndex('by_scope_status', (q) =>
      q.eq('workspaceId', workspaceId).eq('scope', scope).eq('scopeId', scopeId).eq('status', 'active'),
    )
    .collect();
  return entries.filter((entry) => expireStatus(entry, now) === 'active');
}

/** Every claim filed against one scope, whatever its status. */
export async function scopeEntries(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  scope: MemoryScope,
  scopeId: string,
) {
  return ctx.db
    .query('memories')
    .withIndex('by_scope_status', (q) =>
      q.eq('workspaceId', workspaceId).eq('scope', scope).eq('scopeId', scopeId),
    )
    .collect();
}

/** The token budget of one scope. Task claims live with their task and are not budgeted. */
export function scopeBudget(budgets: MemoryBudgets, scope: MemoryScope) {
  return scope === 'task' ? 0 : budgets[scope];
}

/** The workspace's memory budgets, falling back to the product defaults before Settings is saved. */
export async function memoryBudgets(ctx: Ctx, workspaceId: Id<'workspaces'>): Promise<MemoryBudgets> {
  const settings = await ctx.db
    .query('workspaceSettings')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .unique();
  return settings?.memoryBudgets ?? defaultWorkspaceSettings.memoryBudgets;
}

/** Retires one entry in favour of another; the archived entry records what replaced it. */
export async function supersede(ctx: MutationCtx, id: Id<'memories'>, by: Id<'memories'>) {
  await ctx.db.patch(id, { status: 'archived', supersedesId: by, updatedAt: Date.now() });
}

/** Claim text, trimmed to one readable sentence. */
export function cleanClaim(text: string) {
  return cleanText(text, 'Claim', MEMORY_LIMITS.text);
}

/** Tags, lower-cased, deduplicated, and held to the per-scope limits. */
export function cleanTags(tags: string[] | undefined) {
  const cleaned = (tags ?? [])
    .map((tag) => cleanText(tag, 'Tag', MEMORY_LIMITS.tag).toLowerCase())
    .filter((tag, index, all) => all.indexOf(tag) === index);
  if (cleaned.length > MEMORY_LIMITS.tags)
    throw new Error(`A claim carries at most ${MEMORY_LIMITS.tags} tags`);
  return cleaned;
}

/** Confidence is a probability; anything else is a caller error. */
export function cleanConfidence(confidence: number | undefined) {
  const value = confidence ?? 0.8;
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('Confidence must be between 0 and 1');
  return value;
}

/** Resolves a scope target inside the workspace and names it, or rejects a target it does not own. */
export async function scopeTarget(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  scope: MemoryScope,
  scopeId: string,
): Promise<{ scopeId: string; name: string }> {
  const missing = new Error('Memory scope not found');
  if (scope === 'workspace') {
    if (scopeId !== workspaceId) throw missing;
    const workspace = await ctx.db.get(workspaceId);
    return { scopeId, name: workspace?.name ?? 'Workspace' };
  }
  if (scope === 'agent') {
    const id = ctx.db.normalizeId('installations', scopeId);
    const employee = id ? await ctx.db.get(id) : null;
    if (!employee || employee.workspaceId !== workspaceId) throw missing;
    const version = await ctx.db.get(employee.versionId);
    return { scopeId, name: employee.name ?? version?.name ?? 'Employee' };
  }
  if (scope === 'task') {
    const id = ctx.db.normalizeId('tasks', scopeId);
    const task = id ? await ctx.db.get(id) : null;
    if (!task || task.workspaceId !== workspaceId) throw missing;
    return { scopeId, name: task.title };
  }
  if (scope === 'floor') {
    const id = ctx.db.normalizeId('floors', scopeId);
    const floor = id ? await ctx.db.get(id) : null;
    if (!floor || floor.workspaceId !== workspaceId) throw missing;
    return { scopeId, name: floor.name };
  }
  const id = ctx.db.normalizeId('projects', scopeId);
  const project = id ? await ctx.db.get(id) : null;
  if (!project || project.workspaceId !== workspaceId) throw missing;
  return { scopeId, name: project.name };
}
