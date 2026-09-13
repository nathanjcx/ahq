import { v } from 'convex/values';
import { query } from './_generated/server';
import { findChannel } from './lib/posts';
import { requireWorkspace } from './shared';

/**
 * Handoffs waiting on a person, across every floor. A floor's board carries its own; the Work page
 * needs them all at once, since a handoff is something only a person can accept.
 */
export const pendingHandoffs = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id('posts'),
      floorId: v.id('floors'),
      floorName: v.string(),
      fromName: v.string(),
      toEmployeeId: v.id('installations'),
      toEmployeeName: v.string(),
      brief: v.string(),
      sourceTaskId: v.optional(v.id('tasks')),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const floors = await ctx.db
      .query('floors')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect();
    const rows = [];
    for (const floor of floors) {
      if (floor.archivedAt) continue;
      const channel = await findChannel(ctx, workspace._id, 'floor', floor._id);
      if (!channel) continue;
      const posts = await ctx.db
        .query('posts')
        .withIndex('by_channel_kind', (q) => q.eq('channelId', channel._id).eq('kind', 'handoff'))
        .collect();
      for (const post of posts) {
        if (post.handoff?.status !== 'pending') continue;
        rows.push({
          id: post._id,
          floorId: floor._id,
          floorName: floor.name,
          fromName: post.authorName,
          toEmployeeId: post.handoff.toEmployeeId,
          toEmployeeName: post.handoff.toEmployeeName,
          brief: post.handoff.brief,
          ...(post.taskId ? { sourceTaskId: post.taskId } : {}),
          createdAt: post.createdAt,
        });
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});
