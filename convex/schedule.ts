import { v } from 'convex/values';
import type { ModelRate, WorkspaceSettings } from '../lib/contracts';
import { PAGING_TRANSPORTS } from '../lib/paging';
import { isValidTimezone } from '../lib/time';
import { mutation, query } from './_generated/server';
import { scheduleSummaryFor, settingsFor } from './lib/schedule';
import { providerIds, registryToolsFor } from './registry';
import { hiringPolicy, model, overnightPolicy } from './schema';
import { cleanText, requireWorkspace, type DbCtx } from './shared';

/** Ways a person can be reached; the triage workstream delivers them. */
const NOTIFICATION_CHANNELS = ['in_app', ...PAGING_TRANSPORTS];
const MAX_LIST_ENTRIES = 50;

function wholeHour(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0 || value > 24)
    throw new Error(`${field} must be an hour, 0 to 24`);
  return value;
}

function nonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} cannot be negative`);
  return Math.floor(value);
}

/** Allow-lists name reviewed tools, so a typo cannot silently widen or narrow what triage may do. */
async function assertToolNames(ctx: DbCtx, names: string[], field: string) {
  if (names.length > MAX_LIST_ENTRIES) throw new Error(`${field} has too many entries`);
  if (new Set(names).size !== names.length) throw new Error(`${field} lists the same tool twice`);
  if (!names.length) return;
  const reviewed = new Set<string>();
  for (const provider of providerIds)
    for (const tool of await registryToolsFor(ctx, provider))
      if (tool.mode !== 'blocked') reviewed.add(tool.name);
  for (const name of names)
    if (!reviewed.has(name)) throw new Error(`${field} names an unknown tool: ${name}`);
}

function assertRates(rates: ModelRate[]) {
  if (new Set(rates.map((rate) => rate.model)).size !== rates.length)
    throw new Error('Rates list the same model twice');
  for (const rate of rates)
    for (const [field, value] of Object.entries({
      input: rate.input,
      cached: rate.cached,
      output: rate.output,
    }))
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`The ${rate.model} ${field} rate cannot be negative`);
}

/** Validated settings, ready to store. Working hours bound attended hours, which bound nothing else. */
async function validate(ctx: DbCtx, input: Omit<WorkspaceSettings, 'updatedAt'>) {
  if (!isValidTimezone(input.timezone)) throw new Error('Unknown timezone');
  const workingDays = [...new Set(input.workingDays)].sort((a, b) => a - b);
  if (!workingDays.length || workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    throw new Error('Working days must name at least one day of the week');
  const startHour = wholeHour(input.startHour, 'The working day start');
  const endHour = wholeHour(input.endHour, 'The working day end');
  if (endHour <= startHour) throw new Error('The working day must end after it starts');
  const attendedStartHour = wholeHour(input.attendedStartHour, 'The attended start');
  const attendedEndHour = wholeHour(input.attendedEndHour, 'The attended end');
  if (attendedEndHour <= attendedStartHour) throw new Error('Attended hours must end after they start');
  if (attendedStartHour < startHour || attendedEndHour > endHour)
    throw new Error('Attended hours must sit inside working hours');
  if (input.maxConcurrentInstances < 1) throw new Error('A workspace needs at least one concurrent instance');
  const notificationChannels = [...new Set(input.notificationChannels)];
  for (const channel of notificationChannels)
    if (!NOTIFICATION_CHANNELS.includes(channel)) throw new Error(`Unknown notification channel: ${channel}`);
  // The emergency rule counts pages a channel delivered, and the in-app row always lands whether or
  // not anybody looked at it. A workspace that names emergency tools has to have a channel that leaves
  // the building, or merge and deploy would open on three database writes nobody read.
  if (
    input.emergencyAllowList.length &&
    !notificationChannels.some((channel) => PAGING_TRANSPORTS.includes(channel))
  )
    throw new Error(
      'The emergency allow-list needs a notification channel that reaches a person away from the app: add push, slack, or email',
    );
  await assertToolNames(ctx, input.triageAllowList, 'The triage allow-list');
  await assertToolNames(ctx, input.emergencyAllowList, 'The emergency allow-list');
  assertRates(input.rates);
  const budgets = input.memoryBudgets;
  return {
    timezone: input.timezone,
    workingDays,
    startHour,
    endHour,
    attendedStartHour,
    attendedEndHour,
    overnightPolicy: input.overnightPolicy,
    dailyTokenCap: nonNegative(input.dailyTokenCap, 'The daily token cap'),
    triageAllowance: nonNegative(input.triageAllowance, 'The triage allowance'),
    memoryBudgets: {
      workspace: nonNegative(budgets.workspace, 'The workspace memory budget'),
      project: nonNegative(budgets.project, 'The project memory budget'),
      floor: nonNegative(budgets.floor, 'The floor memory budget'),
      agent: nonNegative(budgets.agent, 'The agent memory budget'),
      summaries: nonNegative(budgets.summaries, 'The summaries budget'),
    },
    hiringPolicy: input.hiringPolicy,
    auditPolicy: input.auditPolicy,
    triageAllowList: input.triageAllowList,
    emergencyAllowList: input.emergencyAllowList,
    notificationChannels,
    plan: input.plan,
    monthlyAllowance: nonNegative(input.monthlyAllowance, 'The monthly allowance'),
    maxConcurrentInstances: nonNegative(input.maxConcurrentInstances, 'Concurrent instances'),
    rates: input.rates,
    standards: input.standards.trim() ? cleanText(input.standards, 'Standards', 20_000) : '',
  };
}

/** The workspace's schedule, budgets, and policies. Defaults apply until an administrator saves them. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    return settingsFor(ctx, workspace._id);
  },
});

/** Saves every policy in Settings at once, so a partial write can never leave hours inconsistent. */
export const updateSettings = mutation({
  args: {
    timezone: v.string(),
    workingDays: v.array(v.number()),
    startHour: v.number(),
    endHour: v.number(),
    attendedStartHour: v.number(),
    attendedEndHour: v.number(),
    overnightPolicy,
    dailyTokenCap: v.number(),
    triageAllowance: v.number(),
    memoryBudgets: v.object({
      workspace: v.number(),
      project: v.number(),
      floor: v.number(),
      agent: v.number(),
      summaries: v.number(),
    }),
    hiringPolicy,
    auditPolicy: v.union(v.literal('soft'), v.literal('hard')),
    triageAllowList: v.array(v.string()),
    emergencyAllowList: v.array(v.string()),
    notificationChannels: v.array(v.string()),
    plan: v.union(v.literal('subscription'), v.literal('byok')),
    monthlyAllowance: v.number(),
    maxConcurrentInstances: v.number(),
    rates: v.array(v.object({ model, input: v.number(), cached: v.number(), output: v.number() })),
    standards: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspace, role } = await requireWorkspace(ctx);
    if (role !== 'owner' && role !== 'admin') throw new Error('Workspace administrator access required');
    const values = { ...(await validate(ctx, args)), updatedAt: Date.now() };
    const row = await ctx.db
      .query('workspaceSettings')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .unique();
    if (row) await ctx.db.patch(row._id, values);
    else await ctx.db.insert('workspaceSettings', { workspaceId: workspace._id, ...values });
    return null;
  },
});

/** What the office and the Schedule section show: the hours, where the clock is in them, today's tokens. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const current = await settingsFor(ctx, workspace._id);
    return scheduleSummaryFor(ctx, workspace._id, current, Date.now());
  },
});
