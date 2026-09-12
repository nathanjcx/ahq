import type { AlertPaging } from './contracts/triage';

/**
 * The emergency rule in numbers, in one place: the planner that sends the pages, the authority query
 * the gateway asks, and the interface that explains the wait all read these.
 *
 * Three delivered pages nobody answered open the emergency allow-list, and not before the first of
 * them is twenty minutes old. The scheduler re-pages on this interval, so an unanswered incident
 * reaches the third page well inside the twenty minutes and the wait is the twenty minutes, not the
 * pace of the pages.
 */
export const EMERGENCY_ATTEMPTS = 3;
export const REPAGE_INTERVAL_MS = 7 * 60_000;
export const EMERGENCY_DELAY_MS = 20 * 60_000;
/** Severities worth waking a person for. A low or medium incident waits for the morning. */
export const PAGING_SEVERITIES = ['high', 'critical'];

/** One recorded page, as both Convex and the planner see it. */
export interface PageAttempt {
  sentAt: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
}

/**
 * How far the emergency rule has run on one incident.
 *
 * Attempts count from the first one that still stands rather than over a rolling window, so the
 * count only ever grows while nobody answers. An acknowledgement resets the gate: pages sent before
 * it are spent, and the count starts again from the next one, which is what makes answering a page
 * mid-incident close the emergency allow-list.
 */
export function pagingState(attempts: PageAttempt[], now: number): AlertPaging {
  const answeredAt = attempts
    .map((row) => row.acknowledgedAt)
    .filter((at): at is number => at !== undefined)
    .sort((a, b) => b - a)[0];
  const live = attempts.filter(
    (row) => row.deliveredAt !== undefined && !row.acknowledgedAt && row.sentAt > (answeredAt ?? 0),
  );
  const sentAt = live.map((row) => row.sentAt).sort((a, b) => a - b);
  const firstAttemptAt = sentAt[0];
  const lastAttemptAt = sentAt[sentAt.length - 1];
  const enough = sentAt.length >= EMERGENCY_ATTEMPTS;
  const opensAt =
    firstAttemptAt === undefined
      ? undefined
      : Math.max(firstAttemptAt + EMERGENCY_DELAY_MS, enough ? sentAt[EMERGENCY_ATTEMPTS - 1] : 0);
  return {
    attempts: sentAt.length,
    required: EMERGENCY_ATTEMPTS,
    firstAttemptAt,
    lastAttemptAt,
    opensAt,
    // Answered, and nothing has paged since: a page sent after an acknowledgement reopens the wait.
    acknowledged: answeredAt !== undefined && sentAt.length === 0,
    nextAttemptAt: enough
      ? undefined
      : lastAttemptAt === undefined
        ? now
        : lastAttemptAt + REPAGE_INTERVAL_MS,
  };
}

/**
 * Whether the ledger alone has opened the emergency allow-list: enough pages stand unanswered and the
 * first of them is old enough. Attended hours are the other half of the gate and are checked where the
 * workspace's schedule is known.
 */
export function emergencyOpen(paging: AlertPaging, now: number) {
  // An answer spends every page before it, so an acknowledged ledger counts no attempts at all.
  return paging.attempts >= paging.required && paging.opensAt !== undefined && paging.opensAt <= now;
}
