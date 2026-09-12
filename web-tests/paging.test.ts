import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_DELAY_MS,
  REPAGE_INTERVAL_MS,
  emergencyOpen,
  pagingState,
  type PageAttempt,
} from '../lib/paging';

const at = Date.parse('2026-06-01T02:00:00.000Z');

/** One page, as `recordAttempts` writes it: one row per subject, all stamped with the same `sentAt`. */
function page(sentAt: number, subjects: Partial<PageAttempt>[]): PageAttempt[] {
  return subjects.map((row) => ({ sentAt, ...row }));
}

/** The three rows one page to a three-person workspace leaves behind, all delivered by push. */
function paged(sentAt: number) {
  return page(sentAt, [
    { deliveredAt: sentAt, deliveredChannel: 'push' },
    { deliveredAt: sentAt, deliveredChannel: 'push' },
    { deliveredAt: sentAt, deliveredChannel: 'push' },
  ]);
}

describe('the emergency ledger', () => {
  it('counts pages rather than the people each page reached', () => {
    const one = pagingState(paged(at), at);
    expect(one).toMatchObject({ attempts: 1, firstAttemptAt: at, nextAttemptAt: at + REPAGE_INTERVAL_MS });
    expect(emergencyOpen(one, at + EMERGENCY_DELAY_MS)).toBe(false);

    const three = [...paged(at), ...paged(at + 8 * 60_000), ...paged(at + 16 * 60_000)];
    const state = pagingState(three, at + 16 * 60_000);
    expect(state).toMatchObject({ attempts: 3, firstAttemptAt: at, nextAttemptAt: undefined });
    // Nine rows, three pages: the wait is still the twenty minutes from the first of them.
    expect(emergencyOpen(state, at + 19 * 60_000)).toBe(false);
    expect(emergencyOpen(pagingState(three, at + 21 * 60_000), at + 21 * 60_000)).toBe(true);
  });

  it('does not let the in-app row stand in for reaching a person', () => {
    const rows = [0, 8, 16].flatMap((minutes) =>
      page(at + minutes * 60_000, [
        { deliveredAt: at + minutes * 60_000, deliveredChannel: 'in_app' },
        { deliveredAt: at + minutes * 60_000, deliveredChannel: 'in_app' },
      ]),
    );
    const state = pagingState(rows, at + 21 * 60_000);
    expect(state.attempts).toBe(0);
    expect(state.opensAt).toBeUndefined();
    expect(emergencyOpen(state, at + 21 * 60_000)).toBe(false);
    // The pages were still sent, so the ledger is spent and the scheduler stops at three.
    expect(state.nextAttemptAt).toBeUndefined();
  });

  it('stops paging after three attempts even when no channel delivered one', () => {
    const undelivered = [0, 8].map((minutes) => page(at + minutes * 60_000, [{}])).flat();
    expect(pagingState(undelivered, at + 9 * 60_000)).toMatchObject({
      attempts: 0,
      lastAttemptAt: at + 8 * 60_000,
      nextAttemptAt: at + 8 * 60_000 + REPAGE_INTERVAL_MS,
    });
    expect(pagingState([...undelivered, ...page(at + 16 * 60_000, [{}])], at).nextAttemptAt).toBeUndefined();
  });

  it('spends every page an answer came after, and counts the ones that came later', () => {
    const answeredAt = at + 18 * 60_000;
    const answered = [
      ...paged(at),
      ...page(at + 8 * 60_000, [{ deliveredAt: at, deliveredChannel: 'push', acknowledgedAt: answeredAt }]),
    ];
    expect(pagingState(answered, answeredAt)).toMatchObject({ attempts: 0, acknowledged: true });
    const since = [...answered, ...paged(answeredAt + 60_000)];
    expect(pagingState(since, answeredAt + 60_000)).toMatchObject({ attempts: 1, acknowledged: false });
  });
});
