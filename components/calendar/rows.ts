import type { CalendarEntry, CalendarKind, CalendarStatus, Employee, WorkingHours } from '@/lib/contracts';
import { defaultWorkspaceSettings } from '@/lib/contracts';
import { nextWorkingStart, overnightWindow, startOfDay } from '@/lib/time';

const HOUR_MS = 3_600_000;
const NOON_MS = 12 * HOUR_MS;

/**
 * The hours the calendar draws in. Every workspace has its own; a viewer without one yet gets the
 * platform defaults in their own zone, so the grid still reads as a week rather than nothing.
 */
export function calendarClock(schedule: WorkingHours | undefined): WorkingHours {
  const { workingDays, startHour, endHour, attendedStartHour, attendedEndHour, overnightPolicy } =
    defaultWorkspaceSettings;
  return (
    schedule ?? {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      workingDays,
      startHour,
      endHour,
      attendedStartHour,
      attendedEndHour,
      overnightPolicy,
    }
  );
}

/** Local midnight of each day in a span, plus the boundary that closes the last one. */
export function dayStarts(from: number, days: number, timezone: string) {
  const bounds: number[] = [];
  let noon = startOfDay(from, timezone) + NOON_MS;
  for (let day = 0; day <= days; day++, noon += 86_400_000) bounds.push(startOfDay(noon, timezone));
  return bounds;
}

/** The working window of a local day, or nothing when that day is not worked. */
export function workingBand(dayStart: number, dayEnd: number, clock: WorkingHours) {
  const start = nextWorkingStart(dayStart, clock);
  if (start === undefined || start >= dayEnd) return undefined;
  const end = overnightWindow(start + 1, clock)?.start;
  return end === undefined ? undefined : { start, end };
}

/** One thing drawn on a row. Most are calendar entries; the overnight bands are derived here. */
export interface RowItem {
  id: string;
  kind: CalendarKind | 'overnight';
  title: string;
  startsAt: number;
  endsAt: number;
  status: CalendarStatus;
  /** Absent on derived bands, which nothing can be opened from. */
  entry?: CalendarEntry;
}

export interface CalendarRow {
  id: string;
  name: string;
  detail: string;
  /** Employee rows carry the instance's colour; tower rows belong to the building. */
  color?: string;
  tower: boolean;
  items: RowItem[];
}

const TOWER_ROWS = [
  { id: 'tower:deadlines', name: 'Deadlines', detail: 'Project and milestone dates' },
  { id: 'tower:boardroom', name: 'Boardroom', detail: 'Meetings without an employee' },
  { id: 'tower:audit', name: 'Nightly audit', detail: 'Auditors after hours' },
  { id: 'tower:overnight', name: 'Overnight', detail: 'Cheap mode outside hours' },
] as const;

function itemOf(entry: CalendarEntry): RowItem {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    status: entry.status,
    entry,
  };
}

/** The nights the workspace runs on its cheap models, one band per non-working stretch in the span. */
function overnightBands(bounds: number[], clock: WorkingHours): RowItem[] {
  if (clock.overnightPolicy !== 'cheap') return [];
  const bands = new Map<number, RowItem>();
  for (let day = 0; day < bounds.length - 1; day++) {
    const night = overnightWindow(bounds[day] + NOON_MS, clock);
    if (!night || night.start >= bounds[bounds.length - 1] || night.end <= bounds[0]) continue;
    bands.set(night.start, {
      id: `overnight:${night.start}`,
      kind: 'overnight',
      title: 'Cheap mode',
      startsAt: night.start,
      endsAt: night.end,
      status: night.end <= Date.now() ? 'done' : 'scheduled',
    });
  }
  return [...bands.values()];
}

/**
 * The calendar as rows: one per employee instance, then the rows that belong to the tower itself.
 * An audit is the tower's, never an auditor's; anything with no instance of its own falls through
 * to the deadlines or boardroom row so nothing on the calendar is invisible.
 */
export function calendarRows(
  entries: CalendarEntry[],
  employees: Employee[],
  bounds: number[],
  clock: WorkingHours,
): CalendarRow[] {
  const rows = new Map<string, CalendarRow>();
  for (const employee of employees)
    rows.set(employee.id, {
      id: employee.id,
      name: employee.name,
      detail: employee.role,
      color: employee.color,
      tower: false,
      items: [],
    });
  for (const tower of TOWER_ROWS)
    rows.set(tower.id, { ...tower, tower: true, items: [] });

  for (const entry of entries) {
    const item = itemOf(entry);
    if (entry.kind === 'audit') {
      rows.get('tower:audit')?.items.push(item);
      continue;
    }
    const mine = entry.attendees.filter(
      (attendee) => attendee.kind === 'employee' && rows.has(attendee.id),
    );
    if (!mine.length) {
      const fallback = entry.kind === 'meeting' ? 'tower:boardroom' : 'tower:deadlines';
      rows.get(fallback)?.items.push(item);
      continue;
    }
    for (const attendee of mine) rows.get(attendee.id)?.items.push(item);
  }
  rows.get('tower:overnight')?.items.push(...overnightBands(bounds, clock));

  return [...rows.values()]
    .filter((row) => !row.tower || row.items.length)
    .map((row) => ({ ...row, items: row.items.sort((a, b) => a.startsAt - b.startsAt) }));
}

/** Everything in the span, newest last, grouped under the local day it starts on. */
export function agendaDays(entries: CalendarEntry[], bounds: number[]) {
  return bounds.slice(0, -1).map((start, day) => ({
    start,
    entries: entries
      .filter((entry) => entry.startsAt >= start && entry.startsAt < bounds[day + 1])
      .sort((a, b) => a.startsAt - b.startsAt),
  }));
}
