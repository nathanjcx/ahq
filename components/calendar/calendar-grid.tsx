'use client';

import { CalendarClock, Flag, Moon, ShieldCheck, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import { hourLabel, shortTime } from '../shared/time';
import { workingBand, type CalendarRow, type RowItem } from './rows';
import type { WorkingHours } from '@/lib/contracts';
import { localParts } from '@/lib/time';

const HOUR_MS = 3_600_000;
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY_NUMBER = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const FULL_DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

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
  onOpenDay,
}: {
  rows: CalendarRow[];
  bounds: number[];
  clock: WorkingHours;
  today: string;
  onOpen: (item: RowItem) => void;
  /** A day's heading is the way into the day view, where the hours are readable. */
  onOpenDay: (start: number) => void;
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
          <button
            key={day.start}
            className="cal-day-head"
            aria-label={`Open ${FULL_DAY.format(day.start)}`}
            data-today={new Date(day.start).toDateString() === today}
            data-off={!day.worked}
            onClick={() => onOpenDay(day.start)}
          >
            <span>{WEEKDAY.format(day.start)}</span>
            <strong>{DAY_NUMBER.format(day.start)}</strong>
          </button>
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
 * The window a day is drawn in: its working hours, widened to hold everything that happens outside
 * them and padded by an hour, so the useful part of the day fills the track instead of a flat 24.
 */
function dayWindow(bounds: number[], clock: WorkingHours, rows: CalendarRow[]) {
  const band = workingBand(bounds[0], bounds[1], clock);
  let from = band ? band.start : bounds[0] + 8 * HOUR_MS;
  let to = band ? band.end : bounds[0] + 18 * HOUR_MS;
  for (const row of rows)
    for (const item of row.items) {
      if (item.kind === 'overnight') continue;
      from = Math.min(from, Math.max(bounds[0], item.startsAt));
      to = Math.max(to, Math.min(bounds[1], item.endsAt));
    }
  return { from: Math.max(bounds[0], from - HOUR_MS), to: Math.min(bounds[1], to + HOUR_MS) };
}

/**
 * Blocks that would be drawn on top of each other get a line of their own. A short block still
 * needs room for its title, so overlap is measured against a tenth of the day rather than the clock.
 */
function lanesOf(items: RowItem[], span: number) {
  const minimum = span * 0.1;
  const ends: number[] = [];
  const placed = items.map((item) => {
    const until = Math.max(item.endsAt, item.startsAt + minimum);
    const free = ends.findIndex((end) => end <= item.startsAt);
    const lane = free === -1 ? ends.length : free;
    ends[lane] = until;
    return { item, lane };
  });
  return { placed, lanes: Math.max(1, ends.length) };
}

/**
 * One day on a clock: working hours shaded, the hour now marked, and every block placed where it
 * actually falls. Anything running past the day's edges is clipped to the day it is being read on.
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
  clock: WorkingHours;
  now: number;
  onOpen: (item: RowItem) => void;
}) {
  const { from, to } = dayWindow(bounds, clock, rows);
  const span = to - from;
  const fraction = (at: number) => Math.min(1, Math.max(0, (at - from) / span));
  const band = workingBand(bounds[0], bounds[1], clock);
  const shade = band
    ? ({ '--from': fraction(band.start), '--to': fraction(band.end) } as CSSProperties)
    : undefined;
  const nowAt = now > from && now < to ? fraction(now) : undefined;

  const anchor = band?.start ?? bounds[0];
  const ticks: number[] = [];
  for (let at = anchor - Math.ceil((anchor - from) / HOUR_MS) * HOUR_MS; at < to; at += HOUR_MS)
    if (at >= from) ticks.push(at);

  return (
    <div className="cal-day card">
      <div className="cal-day-row cal-axis-row">
        <div className="cal-gutter" />
        <div className="cal-track" style={{ '--lanes': 1 } as CSSProperties}>
          {ticks.map((at) => (
            <span key={at} className="cal-tick" style={{ '--at': fraction(at) } as CSSProperties}>
              {hourLabel(localParts(at, clock.timezone).hour, clock.timezone)}
            </span>
          ))}
        </div>
      </div>
      {rows.map((row) => {
        const { placed, lanes } = lanesOf(row.items, span);
        return (
          <div key={row.id} className="cal-day-row" data-tower={row.tower}>
            <RowLabel row={row} />
            <div className="cal-track" style={{ '--lanes': lanes } as CSSProperties}>
              {shade && <span className="cal-shade" style={shade} />}
              {nowAt !== undefined && (
                <span className="cal-now" style={{ '--at': nowAt } as CSSProperties} aria-hidden="true" />
              )}
              {placed.map(({ item, lane }) => {
                const left = fraction(item.startsAt);
                return (
                  <span
                    key={item.id}
                    className="cal-slot"
                    style={
                      {
                        '--from': left,
                        '--span': fraction(item.endsAt) - left,
                        '--lane': lane,
                      } as CSSProperties
                    }
                  >
                    <Item item={item} onOpen={onOpen} />
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      {!rows.some((row) => row.items.length) && (
        <p className="cal-quiet">Nothing on the calendar this day.</p>
      )}
    </div>
  );
}
