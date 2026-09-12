import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { ensureSettings, ensureTriageStaff, settingsFor } from './lib/triage';
import { cleanText, requireWorkspace } from './shared';

const MAX_RULES = 50;
const RULE_LIMIT = 120;

/** One alert exactly as the interface renders it. */
function publicAlert(alert: Doc<'alerts'>) {
  return {
    id: alert._id,
    source: alert.source,
    fingerprint: alert.fingerprint,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    url: alert.url,
    status: alert.status,
    triageTaskId: alert.triageTaskId,
    affectedFloorIds: alert.affectedFloorIds,
    occurrences: alert.occurrences,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

export const alerts = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('open'),
        v.literal('triaging'),
        v.literal('fixed'),
        v.literal('closed'),
        v.literal('dismissed'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const status = args.status;
    const rows = status
      ? await ctx.db
          .query('alerts')
          .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id).eq('status', status))
          .order('desc')
          .take(200)
      : await ctx.db
          .query('alerts')
          .withIndex('by_workspace_created', (q) => q.eq('workspaceId', workspace._id))
          .order('desc')
          .take(200);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).map(publicAlert);
  },
});

export const dismiss = mutation({
  args: { alertId: v.id('alerts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.workspaceId !== workspace._id) throw new Error('Alert not found');
    await ctx.db.patch(alert._id, { status: 'dismissed', updatedAt: Date.now() });
    return null;
  },
});

/** Closing is a person confirming the resolution. An alert that was dismissed has no fix to confirm. */
export const close = mutation({
  args: { alertId: v.id('alerts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.workspaceId !== workspace._id) throw new Error('Alert not found');
    if (alert.status === 'dismissed') throw new Error('This alert was dismissed');
    await ctx.db.patch(alert._id, { status: 'closed', updatedAt: Date.now() });
    return null;
  },
});

export const rules = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    return (await settingsFor(ctx, workspace._id)).triageRules ?? [];
  },
});

/** GitHub labels or keywords that turn a native delivery into an alert. Administrators only. */
export const setRules = mutation({
  args: { rules: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    if (role !== 'owner' && role !== 'admin') throw new Error('Workspace administrator access required');
    if (args.rules.length > MAX_RULES) throw new Error('Too many triage rules');
    const triageRules = [
      ...new Set(args.rules.map((rule) => cleanText(rule, 'Triage rule', RULE_LIMIT).toLowerCase())),
    ];
    const settings = await ensureSettings(ctx, workspace._id);
    await ctx.db.patch(settings._id, { triageRules, updatedAt: Date.now() });
    return null;
  },
});

/** The reserved Triage floor and its one triage instance, created once per workspace. */
export const ensureTriageFloor = mutation({
  args: {},
  returns: v.object({ floorId: v.id('floors'), employeeId: v.id('installations') }),
  handler: async (ctx) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const { floor, installation } = await ensureTriageStaff(ctx, workspace, actor.subject);
    return { floorId: floor._id, employeeId: installation._id };
  },
});
