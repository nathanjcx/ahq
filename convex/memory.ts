import { v, type Infer } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import {
  cleanClaim,
  cleanConfidence,
  cleanTags,
  expireStatus,
  memoryBudgets,
  memoryView,
  publicMemory,
  scopeBudget,
  scopeEntries,
  scopeTarget,
  tokenEstimate,
} from './lib/memory';
import { ensureSettings } from './lib/schedule';
import { memoryKind, memoryScope, memoryStatus } from './schema';
import { canSeeTask, requireWorkspace, type Actor, type Ctx, type WorkspaceRole } from './shared';

const summaryView = v.object({
  scope: memoryScope,
  scopeId: v.string(),
  name: v.string(),
  active: v.number(),
  proposed: v.number(),
  contested: v.number(),
  tokens: v.number(),
  budget: v.number(),
});

const budgetsView = v.object({
  workspace: v.number(),
  project: v.number(),
  floor: v.number(),
  agent: v.number(),
  summaries: v.number(),
});

const taskSummaryView = v.object({
  id: v.id('taskSummaries'),
  taskId: v.id('tasks'),
  outcome: v.string(),
  decisions: v.array(v.string()),
  openQuestions: v.array(v.string()),
  artifactIds: v.array(v.id('artifacts')),
  text: v.string(),
  inferred: v.boolean(),
  createdAt: v.number(),
});

function isAdmin(role: WorkspaceRole) {
  return role === 'owner' || role === 'admin';
}

function requireAdmin(role: WorkspaceRole) {
  if (!isAdmin(role)) throw new Error('Workspace administrator access required');
}

/**
 * Who may read a claim: floor, project, and workspace claims are open to the workspace; an
 * employee's notebook is open to administrators and to the people whose tasks it worked on; a task
 * claim follows the task.
 */
async function readableBy(ctx: Ctx, workspaceId: Id<'workspaces'>, actor: Actor, role: WorkspaceRole) {
  let notebooks: Set<string> | undefined;
  const tasks = new Map<string, Doc<'tasks'> | null>();
  return async (entry: Doc<'memories'>) => {
    if (entry.scope === 'agent') {
      if (isAdmin(role)) return true;
      notebooks ??= new Set(
        (
          await ctx.db
            .query('tasks')
            .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
            .collect()
        )
          .filter((task) => task.createdBy === actor.subject)
          .map((task) => String(task.employeeId)),
      );
      return notebooks.has(entry.scopeId);
    }
    if (entry.scope !== 'task') return true;
    if (!tasks.has(entry.scopeId)) {
      const id = ctx.db.normalizeId('tasks', entry.scopeId);
      tasks.set(entry.scopeId, id ? await ctx.db.get(id) : null);
    }
    const task = tasks.get(entry.scopeId);
    return Boolean(task && task.workspaceId === workspaceId && canSeeTask(task, actor.subject));
  };
}

async function requireEntry(ctx: Ctx, workspaceId: Id<'workspaces'>, id: Id<'memories'>) {
  const entry = await ctx.db.get(id);
  if (!entry || entry.workspaceId !== workspaceId) throw new Error('Memory not found');
  return entry;
}

/** Workspace claims are the tower's standing orders, so only an administrator changes them. */
function requireWritable(entry: Doc<'memories'>, role: WorkspaceRole) {
  if (entry.scope === 'workspace') requireAdmin(role);
}

export const list = query({
  args: {
    scope: v.optional(memoryScope),
    scopeId: v.optional(v.string()),
    status: v.optional(memoryStatus),
  },
  returns: v.array(memoryView),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const now = Date.now();
    const rows =
      args.scope && args.scopeId
        ? await scopeEntries(ctx, workspace._id, args.scope, args.scopeId)
        : await ctx.db
            .query('memories')
            .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id))
            .collect();
    const readable = await readableBy(ctx, workspace._id, actor, role);
    const visible: Doc<'memories'>[] = [];
    for (const entry of rows) {
      if (args.scope && entry.scope !== args.scope) continue;
      if (args.scopeId && entry.scopeId !== args.scopeId) continue;
      if (args.status && expireStatus(entry, now) !== args.status) continue;
      if (await readable(entry)) visible.push(entry);
    }
    return visible
      .sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)
      .slice(0, 500)
      .map((entry) => publicMemory(entry, now));
  },
});

export const propose = mutation({
  args: {
    scope: memoryScope,
    scopeId: v.string(),
    kind: memoryKind,
    text: v.string(),
    tags: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({ memoryId: v.id('memories'), status: memoryStatus }),
  handler: async (ctx, args) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    // A person's claim is already the decision the janitor would have to reach, so it activates;
    // the workspace scope is the exception because it speaks for the whole tower.
    if (args.scope === 'workspace') requireAdmin(role);
    const target = await scopeTarget(ctx, workspace._id, args.scope, args.scopeId);
    if (args.scope === 'task') {
      const id = ctx.db.normalizeId('tasks', args.scopeId);
      const task = id ? await ctx.db.get(id) : null;
      if (!task || !canSeeTask(task, actor.subject)) throw new Error('Memory scope not found');
    }
    const now = Date.now();
    const memoryId = await ctx.db.insert('memories', {
      workspaceId: workspace._id,
      scope: args.scope,
      scopeId: target.scopeId,
      kind: args.kind,
      text: cleanClaim(args.text),
      tags: cleanTags(args.tags),
      author: 'person',
      authorName: actor.name,
      confidence: cleanConfidence(args.confidence),
      status: 'active',
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    return { memoryId, status: 'active' as const };
  },
});

export const approve = mutation({
  args: { id: v.id('memories') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    const entry = await requireEntry(ctx, workspace._id, args.id);
    requireWritable(entry, role);
    if (entry.status !== 'proposed') throw new Error('Only a proposed claim can be approved');
    await ctx.db.patch(entry._id, { status: 'active', updatedAt: Date.now() });
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id('memories') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    const entry = await requireEntry(ctx, workspace._id, args.id);
    requireWritable(entry, role);
    await ctx.db.patch(entry._id, { status: 'archived', updatedAt: Date.now() });
    return null;
  },
});

export const resolveContest = mutation({
  args: {
    id: v.id('memories'),
    keep: v.union(v.literal('this'), v.literal('other'), v.literal('neither')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    const entry = await requireEntry(ctx, workspace._id, args.id);
    requireWritable(entry, role);
    if (entry.status !== 'contested') throw new Error('That claim is not contested');
    const other = entry.contestedWithId
      ? await requireEntry(ctx, workspace._id, entry.contestedWithId)
      : null;
    if (other) requireWritable(other, role);
    if (args.keep === 'other' && !other) throw new Error('No competing claim was recorded');
    const now = Date.now();
    const kept = args.keep === 'this' ? entry : args.keep === 'other' ? other : null;
    // The kept claim comes back into service; the other is archived pointing at what replaced it,
    // and the reason stays on the archived side as the record of the conflict.
    if (kept)
      await ctx.db.patch(kept._id, {
        status: 'active',
        contestReason: undefined,
        contestedWithId: undefined,
        updatedAt: now,
      });
    for (const loser of [entry, other])
      if (loser && loser._id !== kept?._id)
        await ctx.db.patch(loser._id, {
          status: 'archived',
          contestedWithId: undefined,
          supersedesId: kept?._id,
          updatedAt: now,
        });
    return null;
  },
});

export const setBudgets = mutation({
  args: { budgets: budgetsView },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    requireAdmin(role);
    if (Object.values(args.budgets).some((value) => !Number.isInteger(value) || value < 0))
      throw new Error('A budget is a whole number of tokens');
    const settings = await ensureSettings(ctx, workspace._id);
    await ctx.db.patch(settings._id, { memoryBudgets: args.budgets, updatedAt: Date.now() });
    return null;
  },
});

export const summaries = query({
  args: { scope: v.union(v.literal('floor'), v.literal('project'), v.literal('workspace')) },
  returns: v.array(summaryView),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const budgets = await memoryBudgets(ctx, workspace._id);
    const targets: { scopeId: string; name: string }[] =
      args.scope === 'workspace'
        ? [{ scopeId: workspace._id, name: workspace.name }]
        : (args.scope === 'floor'
            ? await ctx.db
                .query('floors')
                .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
                .collect()
            : await ctx.db
                .query('projects')
                .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
                .collect()
          ).map((row) => ({ scopeId: row._id, name: row.name }));
    const now = Date.now();
    return Promise.all(
      targets.map(async (target) => {
        const entries = await scopeEntries(ctx, workspace._id, args.scope, target.scopeId);
        const counted = entries.map((entry) => expireStatus(entry, now));
        return {
          scope: args.scope,
          scopeId: target.scopeId,
          name: target.name,
          active: counted.filter((status) => status === 'active').length,
          proposed: counted.filter((status) => status === 'proposed').length,
          contested: counted.filter((status) => status === 'contested').length,
          tokens: entries
            .filter((entry) => expireStatus(entry, now) === 'active')
            .reduce((total, entry) => total + tokenEstimate(entry.text), 0),
          budget: scopeBudget(budgets, args.scope),
        };
      }),
    );
  },
});

export const taskSummary = query({
  args: { taskId: v.id('tasks') },
  returns: v.union(taskSummaryView, v.null()),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== workspace._id || !canSeeTask(task, actor.subject))
      throw new Error('Task not found');
    const summary = await ctx.db
      .query('taskSummaries')
      .withIndex('by_task', (q) => q.eq('taskId', task._id))
      .unique();
    if (!summary) return null;
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
  },
});

const janitorLogView = v.object({
  id: v.id('memories'),
  action: v.union(v.literal('merged'), v.literal('promoted'), v.literal('contested')),
  at: v.number(),
  scope: memoryScope,
  scopeId: v.string(),
  text: v.string(),
  detail: v.string(),
  authorName: v.string(),
});

/**
 * The janitor's log. Curation leaves its record on the claims themselves — a merge is a janitor's
 * claim with the ones it replaced pointing at it, a promotion is a workspace claim naming its
 * source, a contest is a reason written across a pair — so the log is read back off those rather
 * than kept twice. An archive the janitor performed is indistinguishable from a person's and is not
 * claimed here.
 */
export const janitorLog = query({
  args: {},
  returns: v.array(janitorLogView),
  handler: async (ctx) => {
    const { workspace, actor, role } = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query('memories')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    const readable = await readableBy(ctx, workspace._id, actor, role);
    const replaced = new Map<string, number>();
    for (const row of rows)
      if (row.supersedesId) replaced.set(row.supersedesId, (replaced.get(row.supersedesId) ?? 0) + 1);
    const entries: Infer<typeof janitorLogView>[] = [];
    // A contest marks both sides with the same reason, so the pair is one line in the log.
    const pairs = new Set<string>();
    for (const row of rows) {
      if (!(await readable(row))) continue;
      const common = {
        id: row._id,
        scope: row.scope,
        scopeId: row.scopeId,
        text: row.text,
        authorName: row.authorName,
      };
      if (row.author === 'janitor') {
        const count = replaced.get(row._id) ?? 0;
        entries.push(
          row.sourceMemoryId
            ? { ...common, action: 'promoted', at: row.createdAt, detail: 'Proposed for the whole workspace' }
            : {
                ...common,
                action: 'merged',
                at: row.createdAt,
                detail: count
                  ? `Replaced ${count} overlapping ${count === 1 ? 'claim' : 'claims'}`
                  : 'Written during curation',
              },
        );
      }
      if (row.status === 'contested' && row.contestReason) {
        const pair = [String(row._id), String(row.contestedWithId ?? '')].sort().join('|');
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        entries.push({ ...common, action: 'contested', at: row.updatedAt, detail: row.contestReason });
      }
    }
    return entries.sort((a, b) => b.at - a.at).slice(0, 100);
  },
});
