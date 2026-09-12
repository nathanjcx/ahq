import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { ensureReservedInstance } from './reserved';

/** A rule matches a GitHub label or any keyword in the delivery, case-insensitively. */
export function matchesTriageRules(rules: string[], haystacks: string[]) {
  const text = haystacks.join('\n').toLowerCase();
  return rules
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
    .find((rule) => text.includes(rule));
}

/**
 * The reserved Triage floor with its triage instance staffed on it. Created once per workspace and
 * reused by every intake path, so an alert always has somewhere to land.
 */
export async function ensureTriageStaff(ctx: MutationCtx, workspace: Doc<'workspaces'>, createdBy: string) {
  const floors = await ctx.db
    .query('floors')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
    .collect();
  const now = Date.now();
  let floor = floors.find((row) => row.reserved === 'triage');
  if (!floor) {
    const floorId = await ctx.db.insert('floors', {
      workspaceId: workspace._id,
      createdBy,
      name: 'Triage',
      brief: 'Incidents preempt working hours here: reproduce, fix, post the post-mortem, close.',
      employeeIds: [],
      reserved: 'triage',
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get(floorId);
    if (!created) throw new Error('Floor not found');
    floor = created;
  }
  const { installation, version } = await ensureReservedInstance(ctx, workspace._id, 'triage', 'Triage', {
    voice: 'Calm under pressure. You state what broke, what you changed, and what you verified.',
    traits: ['fast', 'cautious', 'methodical'],
  });
  if (installation.floorId !== floor._id) await ctx.db.patch(installation._id, { floorId: floor._id });
  if (!floor.employeeIds.includes(installation._id)) {
    const employeeIds = [...floor.employeeIds, installation._id];
    await ctx.db.patch(floor._id, { employeeIds, updatedAt: now });
    floor = { ...floor, employeeIds };
  }
  return { floor, installation, version };
}

/** An alert is still live until it is closed or dismissed. A settled alert pages nobody. */
export function isOpenAlert(alert: Doc<'alerts'>) {
  return alert.status === 'open' || alert.status === 'triaging' || alert.status === 'fixed';
}

/**
 * The tools only the emergency allow-list admits: the ones whose use means triage acted without
 * permission, and so owes an incident report. A tool on both lists was authorized either way.
 */
export function emergencyOnlyTools(settings: {
  triageAllowList: string[];
  emergencyAllowList: string[];
}) {
  return new Set(settings.emergencyAllowList.filter((tool) => !settings.triageAllowList.includes(tool)));
}
