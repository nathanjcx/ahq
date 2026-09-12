'use client';

import { CalendarClock, Flag, ShieldCheck, Users } from 'lucide-react';
import { shortTime } from '../shared/time';
import { agendaDays, dayFormat, isToday } from './rows';
import type { CalendarEntry, CalendarKind } from '@/lib/contracts';

function KindIcon({ kind }: { kind: CalendarKind }) {
  if (kind === 'meeting') return <Users size={13} />;
  if (kind === 'deadline') return <Flag size={13} />;
  if (kind === 'audit') return <ShieldCheck size={13} />;
  return <CalendarClock size={13} />;
}

function when(entry: CalendarEntry) {
  if (entry.kind === 'deadline') return `Due ${shortTime(entry.startsAt)}`;
  return entry.endsAt > entry.startsAt
    ? `${shortTime(entry.startsAt)} – ${shortTime(entry.endsAt)}`
    : shortTime(entry.startsAt);
}

function who(entry: CalendarEntry) {
  if (!entry.attendees.length) return 'The tower';
  return entry.attendees
    .slice(0, 3)
    .map((attendee) => attendee.name)
    .join(', ');
}

/**
 * The calendar on a phone: a day at a time, in order, with the same entries the grid draws. A day
 * nobody works or nothing happens on still appears, so scrolling matches the week a person expects.
 */
export function AgendaList({
  entries,
  bounds,
  timezone,
  now,
  onOpen,
}: {
  entries: CalendarEntry[];
  bounds: number[];
  timezone: string;
  now: number;
  onOpen: (entry: CalendarEntry) => void;
}) {
  const heading = dayFormat(timezone, { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <div className="cal-agenda card">
      {agendaDays(entries, bounds).map((day) => {
        const today = isToday(day.start, now, timezone);
        return (
          <section key={day.start}>
            <h3 data-today={today}>
              {heading.format(day.start)}
              {today && <span>Today</span>}
            </h3>
            {day.entries.length ? (
              day.entries.map((entry) => (
                <button key={entry.id} className="cal-agenda-row" onClick={() => onOpen(entry)}>
                  <span className="cal-agenda-mark" data-kind={entry.kind}>
                    <KindIcon kind={entry.kind} />
                  </span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {when(entry)} · {who(entry)}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="cal-quiet">Nothing scheduled.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
