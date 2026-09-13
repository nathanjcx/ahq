import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import { settingsFor } from '../lib/schedule';
import { publicNotification } from '../notifications';
import { cleanText, requireService, type Ctx } from '../shared';
import { workspaceForActor } from './context';

const notificationKind = v.union(
  v.literal('triage'),
  v.literal('meeting'),
  v.literal('finding'),
  v.literal('general'),
  v.literal('task'),
);

/**
 * Who a workspace can reach. Convex has no membership list, so this is everyone who created a floor
 * or a project here, plus the owner of a personal workspace. The WorkOS member list belongs to the
 * web service; pass `subjects` explicitly when the caller knows better.
 */
async function workspaceSubjects(ctx: Ctx, workspace: Doc<'workspaces'>) {
  const [floors, projects] = await Promise.all([
    ctx.db
      .query('floors')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
    ctx.db
      .query('projects')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect(),
  ]);
  const owner = workspace.authKey.startsWith('user:') ? [workspace.authKey.slice('user:'.length)] : [];
  const subjects = new Set([
    ...owner,
    ...floors.map((floor) => floor.createdBy),
    ...projects.map((project) => project.createdBy),
  ]);
  // Reserved floors are created by the platform, not by a person there is any point paging.
  subjects.delete('system');
  return [...subjects];
}

/**
 * One attempt to reach each subject, recorded before anything is sent. The rows come back so the
 * worker can deliver them; an attempt counts only once a channel reports delivery.
 */
export async function recordAttempts(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  input: {
    kind: Doc<'notifications'>['kind'];
    title: string;
    text: string;
    alertId?: Id<'alerts'>;
    taskId?: Id<'tasks'>;
    subjects?: string[];
  },
) {
  const settings = await settingsFor(ctx, workspace._id);
  const subjects = input.subjects?.length ? input.subjects : await workspaceSubjects(ctx, workspace);
  // An alert title is allowed to be longer than a notification row holds. Truncating is right where
  // failing is not: a long title must not be the reason nobody is paged, here or on a re-page.
  const title = cleanText(input.title.slice(0, 200), 'Notification title', 200);
  const text = cleanText(input.text.slice(0, 2_000), 'Notification text', 2_000);
  const sentAt = Date.now();
  const { alertId, taskId } = input;
  const ledger = alertId
    ? await ctx.db
        .query('notifications')
        .withIndex('by_alert', (q) => q.eq('alertId', alertId))
        .collect()
    : taskId
      ? await ctx.db
          .query('notifications')
          .withIndex('by_task', (q) => q.eq('taskId', taskId))
          .collect()
      : [];
  const rows = [];
  for (const subject of subjects) {
    const prior = ledger.filter((row) => row.subject === subject);
    const attempt = prior.length + 1;
    const id = await ctx.db.insert('notifications', {
      workspaceId: workspace._id,
      subject,
      kind: input.kind,
      title,
      text,
      alertId,
      taskId,
      channels: settings.notificationChannels,
      attempt,
      sentAt,
    });
    rows.push({
      id,
      subject,
      kind: input.kind,
      title,
      text,
      alertId,
      channels: settings.notificationChannels,
      attempt,
    });
  }
  return rows;
}

export const attempt = mutation({
  args: {
    secret: v.string(),
    workspaceId: v.id('workspaces'),
    kind: notificationKind,
    title: v.string(),
    text: v.string(),
    alertId: v.optional(v.id('alerts')),
    subjects: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');
    return recordAttempts(ctx, workspace, args);
  },
});

export const markDelivered = mutation({
  args: { secret: v.string(), id: v.id('notifications'), channel: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error('Notification not found');
    if (!row.deliveredAt)
      await ctx.db.patch(row._id, {
        deliveredAt: Date.now(),
        deliveredChannel: cleanText(args.channel, 'Channel', 40),
      });
    return null;
  },
});

/** The viewer's notifications, for the web routes that answer a browser or a service worker. */
export const listForSubject = query({
  args: { secret: v.string(), subject: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_subject', (q) => q.eq('subject', args.subject))
      .order('desc')
      .take(100);
    return rows.map(publicNotification);
  },
});

export const acknowledgeForSubject = mutation({
  args: { secret: v.string(), subject: v.string(), id: v.id('notifications') },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const row = await ctx.db.get(args.id);
    if (!row || row.subject !== args.subject) throw new Error('Notification not found');
    if (!row.acknowledgedAt) await ctx.db.patch(row._id, { acknowledgedAt: Date.now() });
    return null;
  },
});

async function subscriptionsFor(ctx: Ctx, subject: string) {
  return ctx.db
    .query('pushSubscriptions')
    .withIndex('by_subject', (q) => q.eq('subject', subject))
    .collect();
}

/**
 * How many browsers one person can register. Every endpoint is one outbound request the web service
 * makes inside an alert's own intake, so an unbounded list is both a fan-out and a way to slow that
 * request down. Ten covers a person's real devices.
 */
const MAX_PUSH_SUBSCRIPTIONS = 10;

/** The browser's push endpoint with its keys already sealed by the web service. */
export const subscribePush = mutation({
  args: {
    secret: v.string(),
    authSubject: v.string(),
    authOrgId: v.optional(v.string()),
    endpoint: v.string(),
    keysCiphertext: v.string(),
  },
  returns: v.object({ subscriptionId: v.id('pushSubscriptions') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const workspace = await workspaceForActor(ctx, args.authSubject, args.authOrgId);
    if (!workspace) throw new Error('Create a workspace first');
    const endpoint = cleanText(args.endpoint, 'Endpoint', 2_048);
    const rows = await subscriptionsFor(ctx, args.authSubject);
    const existing = rows.find((row) => row.endpoint === endpoint);
    if (existing) {
      await ctx.db.patch(existing._id, { keysCiphertext: args.keysCiphertext });
      return { subscriptionId: existing._id };
    }
    if (rows.length >= MAX_PUSH_SUBSCRIPTIONS) throw new Error('Too many push subscriptions');
    const subscriptionId = await ctx.db.insert('pushSubscriptions', {
      workspaceId: workspace._id,
      subject: args.authSubject,
      endpoint,
      keysCiphertext: args.keysCiphertext,
      createdAt: Date.now(),
    });
    return { subscriptionId };
  },
});

export const unsubscribePush = mutation({
  args: { secret: v.string(), authSubject: v.string(), endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const existing = (await subscriptionsFor(ctx, args.authSubject)).find(
      (row) => row.endpoint === args.endpoint,
    );
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** Sealed push endpoints for one subject, unsealed only by the web service that delivers them. */
export const pushTargets = query({
  args: { secret: v.string(), subject: v.string() },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const rows = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_subject', (q) => q.eq('subject', args.subject))
      .collect();
    return rows.map((row) => ({
      id: row._id,
      endpoint: row.endpoint,
      keysCiphertext: row.keysCiphertext,
    }));
  },
});

/** The pages a task sent, the way the planner and the page read them. */
export function taskPages(ctx: MutationCtx | QueryCtx, taskId: Id<'tasks'>) {
  return ctx.db
    .query('notifications')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))
    .collect();
}

/** The person answered or decided: every page this task sent is spent. */
export async function settleTaskPages(ctx: MutationCtx, taskId: Id<'tasks'>) {
  const now = Date.now();
  for (const row of await taskPages(ctx, taskId))
    if (!row.acknowledgedAt) await ctx.db.patch(row._id, { acknowledgedAt: now });
}
