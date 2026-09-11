import { internalMutation } from './_generated/server';

export const wakeWorkers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const signal = await ctx.db
      .query('workerSignals')
      .withIndex('by_name', (q: any) => q.eq('name', 'jobs'))
      .unique();
    if (signal) await ctx.db.patch(signal._id, { revision: signal.revision + 1, updatedAt: now });
    else await ctx.db.insert('workerSignals', { name: 'jobs', revision: 1, updatedAt: now });
  },
});
