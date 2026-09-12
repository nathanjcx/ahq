import { v } from 'convex/values';
import type { ModelId, PlanProjection } from '../lib/contracts';
import { query } from './_generated/server';
import { settingsFor, shiftDate } from './lib/schedule';
import { periodUsage } from './lib/tasks';
import { requireWorkspace } from './shared';

/** The most a caller may ask us to project, so a typo cannot turn into an absurd forecast. */
const MAX_PROJECTED_TOKENS = 1e12;

/**
 * What a roadmap would cost the workspace: allowance consumption on a subscription, or an estimate
 * from the administrator's rates on a key of its own, with the capacity the planner has to spend it.
 *
 * Projected tokens carry no model of their own, so they are priced at the dearest configured rate;
 * an estimate never reads lower than the work will be.
 */
export const projection = query({
  args: { projectedTokens: v.number() },
  handler: async (ctx, args): Promise<PlanProjection> => {
    const { workspace } = await requireWorkspace(ctx);
    if (!Number.isFinite(args.projectedTokens) || args.projectedTokens < 0)
      throw new Error('Projected tokens cannot be negative');
    const projectedTokens = Math.min(Math.floor(args.projectedTokens), MAX_PROJECTED_TOKENS);
    const settings = await settingsFor(ctx, workspace._id);
    const now = Date.now();
    const [usage, installations, todaysShifts] = await Promise.all([
      periodUsage(ctx, workspace._id),
      ctx.db
        .query('installations')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
        .collect(),
      ctx.db
        .query('shifts')
        .withIndex('by_workspace_date', (q) =>
          q.eq('workspaceId', workspace._id).eq('date', shiftDate(now, settings)),
        )
        .collect(),
    ]);

    const usedTokens = usage.reduce((total, row) => total + row.input + row.output, 0);
    const rates = new Map(settings.rates.map((rate) => [rate.model, rate]));
    const unpricedModels: ModelId[] = [];
    let recordedCost = 0;
    for (const row of usage) {
      const rate = rates.get(row.model);
      if (!rate) {
        if (row.input + row.output > 0) unpricedModels.push(row.model);
        continue;
      }
      recordedCost += row.input * rate.input + row.cached * rate.cached + row.output * rate.output;
    }
    const dearest = settings.rates.reduce((worst, rate) => Math.max(worst, rate.input, rate.output), 0);
    const estimatedCost = settings.rates.length ? recordedCost + projectedTokens * dearest : undefined;

    const instances = installations.filter((installation) => installation.status !== 'retired').length;
    const runningShifts = todaysShifts.filter((shift) => shift.endedAt === undefined).length;
    return {
      plan: settings.plan,
      usedTokens,
      projectedTokens,
      monthlyAllowance: settings.monthlyAllowance,
      allowanceUsed: settings.monthlyAllowance
        ? (usedTokens + projectedTokens) / settings.monthlyAllowance
        : 0,
      overAllowance:
        settings.monthlyAllowance > 0 && usedTokens + projectedTokens > settings.monthlyAllowance,
      estimatedCost,
      unpricedModels,
      capacity: {
        instances,
        maxConcurrentInstances: settings.maxConcurrentInstances,
        runningShifts,
        freeSlots: Math.max(0, settings.maxConcurrentInstances - runningShifts),
      },
    };
  },
});
