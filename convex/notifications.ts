import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireWorkspace } from './shared';

/** One notification exactly as the interface renders it. */
export function publicNotification(row: Doc<'notifications'>) {
  return {
    id: row._id,
    kind: row.kind,
    title: row.title,
    text: row.text,
    alertId: row.alertId,
    taskId: row.taskId,
    attempt: row.attempt,
    sentAt: row.sentAt,
    acknowledgedAt: row.acknowledgedAt,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_subject', (q) => q.eq('subject', actor.subject))
      .order('desc')
      .take(100);
    return rows.filter((row) => row.workspaceId === workspace._id).map(publicNotification);
  },
});

/** Acknowledging stops the escalation: it is what the emergency rule counts as an answer. */
export const acknowledge = mutation({
  args: { id: v.id('notifications') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.workspaceId !== workspace._id || row.subject !== actor.subject)
      throw new Error('Notification not found');
    if (!row.acknowledgedAt) await ctx.db.patch(row._id, { acknowledgedAt: Date.now() });
    return null;
  },
});
