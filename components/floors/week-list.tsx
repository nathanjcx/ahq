'use client';

import { ArrowRight, CalendarDays } from 'lucide-react';
import { startOfDay } from '../office/day-replay';
import { useNow, useWeekCalendar } from '../office/use-day';

/** The next seven days of shifts, deadlines, audits, and meetings, as a list beside the office. */
export function WeekList({
  live,
  limit = 8,
  onCalendar,
}: {
  live: boolean;
  limit?: number;
  onCalendar: () => void;
}) {
  const now = useNow(60_000);
  const entries = useWeekCalendar(live ? startOfDay(now) : undefined);
  const shown = entries.slice(0, limit);
  return (
    <section className="week-list" aria-label="This week">
      <div className="section-title">
        <h3>This week</h3>
        <button className="text-button" onClick={onCalendar}>
          Calendar <ArrowRight size={14} />
        </button>
      </div>
      {shown.length ? (
        <ol>
          {shown.map((entry) => (
            <li key={`${entry.at} ${entry.label}`}>
              <span>{entry.at}</span>
              <span>{entry.label}</span>
            </li>
          ))}
          {entries.length > shown.length && (
            <li className="week-more">
              <span />
              <button className="text-button" onClick={onCalendar}>
                {entries.length - shown.length} more
              </button>
            </li>
          )}
        </ol>
      ) : (
        <p className="week-empty">
          <CalendarDays size={14} /> Nothing scheduled this week.
        </p>
      )}
    </section>
  );
}
