import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { findChannel, recentPosts } from './lib/posts';
import { ensureSettings, settingsFor } from './lib/schedule';
import { alertPaging, ensureTriageStaff, isOpenAlert } from './lib/triage';
import { cleanText, requireWorkspace, type Ctx } from './shared';

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

function alertNotifications(ctx: Ctx, alertId: Id<'alerts'>) {
  return ctx.db
    .query('notifications')
    .withIndex('by_alert', (q) => q.eq('alertId', alertId))
    .collect();
}

/**
 * One alert with how far the emergency rule has run on it. A closed alert pages nobody, so its
 * paging state is the resting one rather than whatever the ledger last held.
 */
async function alertView(ctx: Ctx, alert: Doc<'alerts'>, now: number) {
  return {
    ...publicAlert(alert),
    paging: alertPaging(isOpenAlert(alert) ? await alertNotifications(ctx, alert._id) : [], now),
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
    const now = Date.now();
    return Promise.all(
      rows.sort((a, b) => b.updatedAt - a.updatedAt).map((alert) => alertView(ctx, alert, now)),
    );
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

async function requireAlert(ctx: Ctx, workspaceId: Id<'workspaces'>, alertId: Id<'alerts'>) {
  const alert = await ctx.db.get(alertId);
  if (!alert || alert.workspaceId !== workspaceId) throw new Error('Alert not found');
  return alert;
}

/**
 * A person answering the page. Acknowledgement is what the emergency rule counts as an answer, so
 * this closes the emergency allow-list for every page this incident sent to this viewer at once.
 */
export const acknowledgeAlert = mutation({
  args: { alertId: v.id('alerts') },
  returns: v.object({ acknowledged: v.number() }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const alert = await requireAlert(ctx, workspace._id, args.alertId);
    const now = Date.now();
    const mine = (await alertNotifications(ctx, alert._id)).filter(
      (row) => row.subject === actor.subject && !row.acknowledgedAt,
    );
    for (const row of mine) await ctx.db.patch(row._id, { acknowledgedAt: now });
    return { acknowledged: mine.length };
  },
});

/** Which floors an incident touches. Their channels already carry the notice; this corrects it. */
export const assignFloors = mutation({
  args: { alertId: v.id('alerts'), floorIds: v.array(v.id('floors')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const alert = await requireAlert(ctx, workspace._id, args.alertId);
    const affectedFloorIds = [];
    for (const floorId of [...new Set(args.floorIds)]) {
      const floor = await ctx.db.get(floorId);
      if (!floor || floor.workspaceId !== workspace._id) throw new Error('Floor not found');
      affectedFloorIds.push(floor._id);
    }
    await ctx.db.patch(alert._id, { affectedFloorIds, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Everything that happened to one alert, in order: the intake, the triage run, the provider calls it
 * made and under which authority, every page sent to a person, and the posts it wrote. Arguments and
 * results stay sealed — a tool name, its outcome, and when it ran are what a person reads here.
 */
export const timeline = query({
  args: { alertId: v.id('alerts') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const alert = await requireAlert(ctx, workspace._id, args.alertId);
    const settings = await settingsFor(ctx, workspace._id);
    const emergencyOnly = new Set(
      settings.emergencyAllowList.filter((tool) => !settings.triageAllowList.includes(tool)),
    );
    const entries: {
      id: string;
      at: number;
      kind: 'intake' | 'run' | 'tool' | 'page' | 'post';
      title: string;
      detail?: string;
      authority?: 'allow_list' | 'emergency';
      outcome?: string;
      taskId?: string;
      postId?: string;
    }[] = [
      {
        id: `intake:${alert._id}`,
        at: alert.createdAt,
        kind: 'intake',
        title: `${alert.source} alert received`,
        detail:
          alert.occurrences > 1
            ? `${alert.occurrences} deliveries share this fingerprint.`
            : alert.fingerprint,
      },
    ];

    const task = alert.triageTaskId ? await ctx.db.get(alert.triageTaskId) : null;
    if (task) {
      entries.push({
        id: `run:${task._id}`,
        at: task.createdAt,
        kind: 'run',
        title: `Triage run opened for ${task.employeeName}`,
        detail: task.title,
        outcome: task.status,
        taskId: task._id,
      });
      const calls = await ctx.db
        .query('toolCalls')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .order('desc')
        .take(100);
      for (const call of calls)
        if (call.outcome !== 'started')
          entries.push({
            id: `tool:${call._id}`,
            at: call.createdAt,
            kind: 'tool',
            title: call.tool,
            detail: call.reason,
            authority: emergencyOnly.has(call.tool) ? 'emergency' : 'allow_list',
            outcome: call.outcome,
            taskId: task._id,
          });
    }

    for (const page of await alertNotifications(ctx, alert._id))
      entries.push({
        id: `page:${page._id}`,
        at: page.sentAt,
        kind: 'page',
        title: `Notification attempt ${page.attempt}`,
        detail: page.deliveredChannel
          ? `Delivered by ${page.deliveredChannel}`
          : `Sent to ${page.channels.join(', ') || 'no channel'}; nothing delivered`,
        outcome: page.acknowledgedAt ? 'acknowledged' : page.deliveredAt ? 'delivered' : 'undelivered',
      });

    const channel = await findChannel(ctx, workspace._id, 'triage', '');
    if (channel && task)
      for (const post of await recentPosts(ctx, channel._id, 200))
        if (post.taskId === task._id)
          entries.push({
            id: `post:${post._id}`,
            at: post._creationTime,
            kind: 'post',
            title: `${post.authorName} posted a ${post.kind}`,
            detail: post.text.slice(0, 600),
            postId: post._id,
            taskId: task._id,
          });

    return entries.sort((a, b) => a.at - b.at);
  },
});

/**
 * The post-mortems and incident reports the triage floor has filed, newest first. They are findings
 * in the triage channel; one is an emergency report when its run reached the emergency allow-list.
 */
export const incidentReports = query({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const settings = await settingsFor(ctx, workspace._id);
    const emergencyOnly = new Set(
      settings.emergencyAllowList.filter((tool) => !settings.triageAllowList.includes(tool)),
    );
    const channel = await findChannel(ctx, workspace._id, 'triage', '');
    if (!channel) return [];
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_channel_kind', (q) => q.eq('channelId', channel._id).eq('kind', 'finding'))
      .order('desc')
      .take(20);
    return Promise.all(
      posts.map(async (post) => {
        const taskId = post.taskId;
        const alert = taskId
          ? await ctx.db
              .query('alerts')
              .withIndex('by_triage_task', (q) => q.eq('triageTaskId', taskId))
              .first()
          : null;
        const calls = taskId
          ? await ctx.db
              .query('toolCalls')
              .withIndex('by_task', (q) => q.eq('taskId', taskId))
              .take(100)
          : [];
        return {
          id: post._id,
          alertId: alert?._id,
          alertTitle: alert?.title,
          severity: alert?.severity,
          authorName: post.authorName,
          text: post.text,
          taskId,
          emergency: calls.some(
            (call) => emergencyOnly.has(call.tool) && call.outcome === 'succeeded',
          ),
          createdAt: post._creationTime,
        };
      }),
    );
  },
});

/**
 * How alerts get in: the signed endpoint's readiness, the GitHub rules, and whether mail is being
 * classified. The signing secret itself is never returned — it is written once and only sealed.
 */
export const intake = query({
  args: {},
  returns: v.object({
    signedEndpointReady: v.boolean(),
    rules: v.array(v.string()),
    github: v.array(v.string()),
    emailClassification: v.boolean(),
  }),
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const settings = await settingsFor(ctx, workspace._id);
    const stored = await ctx.db
      .query('workspaceSettings')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .unique();
    const connections = await ctx.db
      .query('connections')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    const connected = connections.filter((row) => row.status === 'connected');
    return {
      signedEndpointReady: Boolean(stored?.alertSecretCiphertext),
      rules: settings.triageRules ?? [],
      github: connected
        .filter((row) => row.provider === 'github')
        .flatMap((row) => row.inboxResources)
        .slice(0, 20),
      emailClassification: connected.some(
        (row) => row.provider === 'google-workspace' && row.inboxResources.length > 0,
      ),
    };
  },
});

/** Clears the whole ledger for this viewer, for when the pages have all been read at once. */
export const acknowledgeNotifications = mutation({
  args: {},
  returns: v.object({ acknowledged: v.number() }),
  handler: async (ctx) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_subject', (q) => q.eq('subject', actor.subject))
      .order('desc')
      .take(100);
    const now = Date.now();
    const mine = rows.filter((row) => row.workspaceId === workspace._id && !row.acknowledgedAt);
    for (const row of mine) await ctx.db.patch(row._id, { acknowledgedAt: now });
    return { acknowledged: mine.length };
  },
});
