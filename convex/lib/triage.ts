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

/**
 * The emergency rule in numbers, shared by the authority query, the gateway, and the interface:
 * attempts stop counting past this window, so an old unanswered page cannot authorize anything, and
 * fewer than this many delivered, unanswered pages leaves the emergency allow-list shut.
 */
export const ATTEMPT_WINDOW_MS = 20 * 60 * 1_000;
export const EMERGENCY_ATTEMPTS = 3;

/** An alert is still live until it is closed or dismissed. A settled alert pages nobody. */
export function isOpenAlert(alert: Doc<'alerts'>) {
  return alert.status === 'open' || alert.status === 'triaging' || alert.status === 'fixed';
}

/**
 * How far the emergency rule has run for one alert: delivered pages nobody answered inside the
 * window, and when the allow-list opens. Three pages are spaced across the window, so an unanswered
 * incident reaches the third at roughly a window after the first; that is the deadline a person is
 * shown while the pages are still going out.
 */
export function pagingState(notifications: Doc<'notifications'>[], now: number) {
  const live = notifications.filter((row) => row.sentAt >= now - ATTEMPT_WINDOW_MS);
  const unanswered = live.filter((row) => row.deliveredAt !== undefined && !row.acknowledgedAt);
  const sentAt = unanswered.map((row) => row.sentAt).sort((a, b) => a - b);
  const firstAttemptAt = sentAt[0];
  return {
    attempts: unanswered.length,
    required: EMERGENCY_ATTEMPTS,
    firstAttemptAt,
    lastAttemptAt: sentAt[sentAt.length - 1],
    opensAt:
      sentAt.length >= EMERGENCY_ATTEMPTS
        ? sentAt[EMERGENCY_ATTEMPTS - 1]
        : firstAttemptAt === undefined
          ? undefined
          : firstAttemptAt + ATTEMPT_WINDOW_MS,
    acknowledged: live.some((row) => row.acknowledgedAt !== undefined),
  };
}
