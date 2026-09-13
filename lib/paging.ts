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
/**
 * A task waiting on a person, for a question or an approval, is paged once it has waited this long,
 * then on the re-page interval up to the same ceiling of three. Answering or deciding settles it.
 */
export const WAIT_PAGE_DELAY_MS = 15 * 60_000;
/** Severities worth waking a person for. A low or medium incident waits for the morning. */
export const PAGING_SEVERITIES = ['high', 'critical'];
/**
 * Channels that reach a person who is not looking at the app. The in-app row always lands, so an
 * in-app delivery says nothing about whether anybody was told; it cannot be what opens merge and
 * deploy. A workspace with no transport here can still page, but the emergency rule stays shut.
 */
export const PAGING_TRANSPORTS = ['push', 'slack', 'email'];

/** One recorded page to one person, as both Convex and the planner see it. */
export interface PageAttempt {
  sentAt: number;
  deliveredAt?: number;
  deliveredChannel?: string;
  acknowledgedAt?: number;
}

/** One page, however many people it was sent to. */
export interface LivePage {
  sentAt: number;
  /** At least one person was reached away from the app. Only these count toward the emergency rule. */
  delivered: boolean;
}

/**
 * The pages on one incident that still stand, one entry per page rather than per person paged.
 *
 * `recordAttempts` writes a row per subject and stamps the whole batch with one `sentAt`, so counting
 * rows would let a workspace with three people reach the emergency gate on a single page. An
 * acknowledgement spends every page sent before it, which is what makes answering mid-incident close
 * the emergency allow-list.
 */
export function livePages(rows: PageAttempt[]) {
  const answeredAt = rows
    .map((row) => row.acknowledgedAt)
    .filter((at): at is number => at !== undefined)
    .sort((a, b) => b - a)[0];
  const delivered = new Map<number, boolean>();
  for (const row of rows) {
    if (row.acknowledgedAt !== undefined || row.sentAt <= (answeredAt ?? 0)) continue;
    const away = row.deliveredAt !== undefined && PAGING_TRANSPORTS.includes(row.deliveredChannel ?? '');
    delivered.set(row.sentAt, (delivered.get(row.sentAt) ?? false) || away);
  }
  const pages: LivePage[] = [...delivered]
    .map(([sentAt, away]) => ({ sentAt, delivered: away }))
    .sort((a, b) => a.sentAt - b.sentAt);
  return { answeredAt, pages };
}

/**
 * How far the emergency rule has run on one incident.
 *
 * Attempts count from the first page that still stands rather than over a rolling window, so the
 * count only ever grows while nobody answers. Only pages a real transport delivered count toward the
 * gate; every page that was sent, delivered or not, sets the pace of the next one and the ceiling of
 * three, so a workspace whose channels deliver nothing pages three times and then stops instead of
 * paging on every tick for as long as the incident is open.
 */
export function pagingState(rows: PageAttempt[], now: number): AlertPaging {
  const { answeredAt, pages } = livePages(rows);
  const sentAt = pages.filter((page) => page.delivered).map((page) => page.sentAt);
  const firstAttemptAt = sentAt[0];
  const lastAttemptAt = pages[pages.length - 1]?.sentAt;
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
    acknowledged: answeredAt !== undefined && pages.length === 0,
    nextAttemptAt:
      pages.length >= EMERGENCY_ATTEMPTS
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
