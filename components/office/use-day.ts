'use client';

import { useEffect, useMemo, useState } from 'react';
import { shiftsFromCalendar, type DayInput } from './activity';
import { DAY_MS } from './day-replay';
import { calendarWall, type CalendarEntry } from './office-layout';
import { useUiQuery } from '@/components/shared/use-ui-query';
import { asId, uiApi } from '@/lib/ui-api';

/**
 * The clock the rooms read. Activities age out on their own, so a room re-reads
 * the journal on a slow tick rather than waiting for the next subscription.
 */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * One day of the workspace, from the subscriptions the office already has a
 * right to. Shifts come from the calendar's own shift blocks, so the office
 * needs nothing the calendar does not already answer, and anything the backend
 * has not answered simply leaves that part of the day empty.
 */
export function useDayQueries(from: number): DayInput {
  const to = from + DAY_MS;
  const range = useMemo(() => ({ from, to }), [from, to]);
  const entries = useUiQuery(uiApi.calendarEntries, range);
  const findings = useUiQuery(uiApi.auditFindings, {});
  const alerts = useUiQuery(uiApi.alerts, {});
  const notifications = useUiQuery(uiApi.notifications, {});
  // One meeting at a time: the day only ever has one boardroom.
  const entry = (entries ?? []).find((item) => item.kind === 'meeting' && item.status !== 'cancelled');
  const meeting = useUiQuery(
    uiApi.meeting,
    entry ? { calendarEntryId: asId<'calendarEntries'>(entry.id) } : 'skip',
  );
  return useMemo(
    () => ({
      shifts: shiftsFromCalendar(entries ?? []),
      ...(entry ? { meetings: [{ entry, ...(meeting ? { meeting } : {}) }] } : {}),
      findings: (findings ?? []).filter((item) => item.createdAt < to),
      alerts: (alerts ?? []).filter((item) => item.createdAt < to),
      notifications: (notifications ?? []).filter((item) => item.sentAt < to),
    }),
    [to, entries, entry, meeting, findings, alerts, notifications],
  );
}

/** The lobby's wall covers the week ahead, starting with what is left of today. */
const WEEK_MS = 7 * DAY_MS;

/**
 * The coming week, as the lobby's calendar wall reads it. `from` is local midnight
 * today; without one the lobby is not on show and nothing is asked for.
 */
export function useWeekCalendar(from?: number): CalendarEntry[] {
  const range = useMemo(() => (from === undefined ? null : { from, to: from + WEEK_MS }), [from]);
  const entries = useUiQuery(uiApi.calendarEntries, range ?? 'skip');
  return useMemo(() => (range && entries ? calendarWall(entries, range.from) : []), [range, entries]);
}
