'use client';

import { useMemo } from 'react';
import { shiftsFromCalendar, type DayInput } from './activity';
import { DAY_MS } from './day-replay';
import { useUiQuery } from '@/components/shared/use-ui-query';
import { asId, uiApi } from '@/lib/ui-api';

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
