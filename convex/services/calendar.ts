import { v } from 'convex/values';
import { query } from '../_generated/server';
import { requireService } from '../shared';

/** How far ahead working memory looks for the next meeting. */
const HORIZON_MS = 14 * 86_400_000;
const MAX_ENTRIES = 10;

/**
 * The meetings an employee is expected at, for the working memory a turn opens with. Agenda and
 * purpose come along because that is what an employee has to prepare against.
 */
export const upcoming = query({
  args: {
    secret: v.string(),
    workspaceId: v.id('workspaces'),
    employeeId: v.optional(v.id('installations')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const now = Date.now();
    const limit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(args.limit ?? MAX_ENTRIES)));
    const entries = await ctx.db
      .query('calendarEntries')
      .withIndex('by_workspace_start', (q) =>
        q
          .eq('workspaceId', args.workspaceId)
          .gte('startsAt', now)
          .lte('startsAt', now + HORIZON_MS),
      )
      .take(200);
    return entries
      .filter(
        (entry) =>
          entry.kind === 'meeting' &&
          entry.status !== 'cancelled' &&
          (!args.employeeId || entry.attendees.some((one) => one.id === args.employeeId)),
      )
      .slice(0, limit)
      .map((entry) => ({
        id: entry._id,
        title: entry.title,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        projectId: entry.projectId,
        floorId: entry.floorId,
        attendees: entry.attendees,
        agenda: entry.agenda,
        purpose: entry.purpose,
      }));
  },
});
