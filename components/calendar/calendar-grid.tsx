'use client';

import { CalendarClock, Flag, Moon, ShieldCheck, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import { hourLabel, shortTime } from '../shared/time';
import { fractionOf, workingBand, type CalendarRow, type RowItem } from './rows';
import type { ScheduleSummary } from '@/lib/contracts';

/** Hours the day view labels. Every third hour keeps the axis readable at a phone's width too. */
const AXIS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY_NUMBER = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

function ItemIcon({ kind }: { kind: RowItem['kind'] }) {
  if (kind === 'meeting') return <Users size={12} />;
  if (kind === 'deadline') return <Flag size={12} />;
  if (kind === 'audit') return <ShieldCheck size={12} />;
  if (kind === 'overnight') return <Moon size={12} />;
  return <CalendarClock size={12} />;
}

function RowLabel({ row }: { row: CalendarRow }) {
  return (
    <div className="cal-row-label" style={{ '--row-color': row.color ?? '#8d9a8a' } as CSSProperties}>
      <strong>{row.name}</strong>
      <small>{row.detail}</small>
    </div>
  );
}

/** What a block says when it is read aloud or hovered, since a narrow block shows only its title. */
function itemTitle(item: RowItem) {
  const span = item.endsAt > item.startsAt ? `${shortTime(item.startsAt)}–${shortTime(item.endsAt)}` : shortTime(item.startsAt);
  return `${item.title} · ${span}`;
}

function Item({ item, onOpen }: { item: RowItem; onOpen: (item: RowItem) => void }) {
  const label = itemTitle(item);
  if (!item.entry)
    return (
      <span className="cal-item cal-static" data-kind={item.kind} title={label}>
        <ItemIcon kind={item.kind} />
        <span>{item.title}</span>
      </span>
    );
  return (
    <button
      className="cal-item"
      data-kind={item.kind}
      data-status={item.status}
      title={label}
      onClick={() => onOpen(item)}
    >
      <ItemIcon kind={item.kind} />
      <span>{item.title}</span>
    </button>
  );
}

/**
 * A week as a resource board: one column per day, one row per instance, and the tower's own rows
 * underneath. Days name what happens on them rather than where in the hour it happens; the day view
 * is where a person reads the clock.
 */
export function WeekGrid({
  rows,
  bounds,
  clock,
  today,
  onOpen,
}: {
  rows: CalendarRow[];
  bounds: number[];
  clock: ScheduleSummary;
  today: string;
  onOpen: (item: RowItem) => void;
}) {
  const days = bounds.slice(0, -1).map((start, index) => ({
    start,
    end: bounds[index + 1],
    worked: workingBand(start, bounds[index + 1], clock) !== undefined,
  }));
  return (
    <div className="cal-week card">
      <div className="cal-week-head">
        <div className="cal-gutter" />
        {days.map((day) => (
          <div
            key={day.start}
            className="cal-day-head"
            data-today={new Date(day.start).toDateString() === today}
            data-off={!day.worked}
          >
            <span>{WEEKDAY.format(day.start)}</span>
            <strong>{DAY_NUMBER.format(day.start)}</strong>
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.id} className="cal-week-row" data-tower={row.tower}>
          <RowLabel row={row} />
          {days.map((day) => (
            <div
              key={day.start}
              className="cal-cell"
              data-today={new Date(day.start).toDateString() === today}
              data-off={!day.worked}
            >
              {row.items
                .filter((item) => item.startsAt >= day.start && item.startsAt < day.end)
                .map((item) => (
                  <Item key={item.id} item={item} onOpen={onOpen} />
                ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One day on a clock: working hours shaded, the hour now marked, and every block placed where it
 * actually falls. Overnight bands run past both edges, so a block is clipped to the day it is in.
 */
export function DayTimeline({
  rows,
  bounds,
  clock,
  now,
  onOpen,
}: {
  rows: CalendarRow[];
  bounds: number[];
  clock: ScheduleSummary;
  now: number;
  onOpen: (item: RowItem) => void;
}) {
  const band = workingBand(bounds[0], bounds[1], clock);
  const shade = band
    ? ({ '--from': fractionOf(band.start, bounds), '--to': fractionOf(band.end, bounds) } as CSSProperties)
    : undefined;
  const nowAt = now > bounds[0] && now < bounds[bounds.length - 1] ? fractionOf(now, bounds) : undefined;
  return (
    <div className="cal-day card">
      <div className="cal-day-row cal-axis-row">
        <div className="cal-gutter" />
        <div className="cal-track">
          {AXIS_HOURS.map((hour) => (
            <span
              key={hour}
              className="cal-tick"
              style={{ '--at': hour / 24 } as CSSProperties}
            >
              {hourLabel(hour, clock.timezone)}
            </span>
          ))}
        </div>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="cal-day-row" data-tower={row.tower}>
          <RowLabel row={row} />
          <div className="cal-track">
            {shade && <span className="cal-shade" style={shade} />}
            {nowAt !== undefined && (
              <span className="cal-now" style={{ '--at': nowAt } as CSSProperties} aria-hidden="true" />
            )}
            {row.items.map((item) => {
              const from = fractionOf(item.startsAt, bounds);
              const to = fractionOf(item.endsAt, bounds);
              return (
                <span
                  key={item.id}
                  className="cal-slot"
                  style={{ '--from': from, '--span': Math.max(0, to - from) } as CSSProperties}
                >
                  <Item item={item} onOpen={onOpen} />
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {!rows.some((row) => row.items.length) && <p className="cal-quiet">Nothing on the calendar this day.</p>}
    </div>
  );
}
