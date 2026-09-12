import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export function taskReservation(model: string) {
  const global = Number(process.env.TASK_RESERVED_COST_USD);
  if (Number.isFinite(global) && global > 0) return global;
  const defaults: Record<string, number> = {
    'gpt-5.6-luna': 0.25,
    'gpt-5.6-terra': 1,
    'gpt-5.6-sol': 2,
    'gpt-6-astra': 5,
  };
  const envName = `TASK_RESERVED_COST_USD_${model.split('-').at(-1)?.toUpperCase()}`;
  const configured = Number(process.env[envName]);
  return Number.isFinite(configured) && configured > 0 ? configured : defaults[model] || 1;
}

export function utcBillingPeriod(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7);
}

export function currentSpend(workspace: Doc<'workspaces'>, now = Date.now()) {
  return workspace.billingPeriod === utcBillingPeriod(now) ? workspace.spent : 0;
}

export async function reserveBudget(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  amount: number,
  now = Date.now(),
) {
  const billingPeriod = utcBillingPeriod(now);
  const spent = workspace.billingPeriod === billingPeriod ? workspace.spent : 0;
  if (spent + workspace.reserved + amount > workspace.monthlyBudget)
    throw new Error('Monthly workspace budget reached');
  await ctx.db.patch(workspace._id, {
    billingPeriod,
    spent,
    reserved: workspace.reserved + amount,
  });
}

export async function addSpend(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  amount: number,
  now = Date.now(),
) {
  const billingPeriod = utcBillingPeriod(now);
  const spent = workspace.billingPeriod === billingPeriod ? workspace.spent : 0;
  await ctx.db.patch(workspace._id, { billingPeriod, spent: spent + Math.max(0, amount) });
}
