import type { WorkingHours } from './contracts/schedule';

/**
 * Timezone and working-hours arithmetic. Every function is pure and takes the zone explicitly, so the
 * planner, the Convex queries, and the interface all answer the same question the same way.
 */

/** The clock settings these functions need; `WorkspaceSettings` and `ScheduleSummary` both satisfy it. */
export type TimeSettings = Omit<WorkingHours, 'overnightPolicy'>;

/** A wall-clock reading in one zone. */
export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday, matching `workingDays`. */
  weekday: number;
  /** YYYY-MM-DD in the zone. */
  date: string;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Building an `Intl.DateTimeFormat` is expensive and the planner reads the clock many times per tick. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  const cached = formatters.get(timezone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  formatters.set(timezone, made);
  return made;
}

/** Whether a zone name is one this runtime knows, so settings can reject a typo. */
export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of an instant in a zone. */
export function localParts(now: number, timezone: string): LocalParts {
  const fields: Record<string, string> = {};
  for (const part of formatter(timezone).formatToParts(now)) fields[part.type] = part.value;
  const year = Number(fields.year);
  const month = Number(fields.month);
  const day = Number(fields.day);
  return {
    year,
    month,
    day,
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(fields.weekday)),
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** YYYY-MM-DD in the workspace zone. The key every per-day record is stored under. */
export function dateKey(now: number, timezone: string) {
  return localParts(now, timezone).date;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(at: number, timezone: string) {
  const parts = localParts(at, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a local wall-clock hour happens on a local date. Resolved in two passes because the
 * offset itself depends on the answer; across a DST jump the second pass lands on the real instant.
 */
function zonedTimestamp(date: Pick<LocalParts, 'year' | 'month' | 'day'>, hour: number, timezone: string) {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour);
  const firstGuess = naive - offsetAt(naive, timezone);
  return naive - offsetAt(firstGuess, timezone);
}

/** Local midnight of the day an instant falls in. */
export function startOfDay(now: number, timezone: string) {
  return zonedTimestamp(localParts(now, timezone), 0, timezone);
}

/** Local noon, the instant to step by whole days from: a DST shift never moves noon out of its day. */
function noonOf(now: number, timezone: string) {
  return startOfDay(now, timezone) + 12 * HOUR_MS;
}

/** The working window of the local day an instant falls in, or nothing when that day is not worked. */
function windowFor(inDay: number, settings: TimeSettings) {
  const parts = localParts(inDay, settings.timezone);
  if (!settings.workingDays.includes(parts.weekday) || settings.endHour <= settings.startHour)
    return undefined;
  return {
    start: zonedTimestamp(parts, settings.startHour, settings.timezone),
    end: zonedTimestamp(parts, settings.endHour, settings.timezone),
  };
}

/** How far ahead or behind the calendar is scanned before a workspace is treated as never working. */
const SCAN_DAYS = 14;

/** Whether an instant falls on a worked day, between two whole local hours. */
function withinHours(now: number, settings: TimeSettings, fromHour: number, toHour: number) {
  const parts = localParts(now, settings.timezone);
  if (!settings.workingDays.includes(parts.weekday)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= fromHour * 60 && minutes < toHour * 60;
}

/** Whether the workspace is inside its working hours right now. */
export function isWorkingTime(now: number, settings: TimeSettings) {
  return withinHours(now, settings, settings.startHour, settings.endHour);
}

/** Whether a person is expected to be reachable right now. Attended hours sit inside working hours. */
export function isAttendedTime(now: number, settings: TimeSettings) {
  return withinHours(now, settings, settings.attendedStartHour, settings.attendedEndHour);
}

/**
 * The start of the next working window beginning at or after `now`. Inside a working window that is
 * tomorrow's start, not this one's. Undefined when no day in the next two weeks is worked.
 */
export function nextWorkingStart(now: number, settings: TimeSettings): number | undefined {
  let cursor = noonOf(now, settings.timezone);
  for (let day = 0; day <= SCAN_DAYS; day++, cursor += DAY_MS) {
    const window = windowFor(cursor, settings);
    if (window && window.start >= now) return window.start;
  }
  return undefined;
}

/** The end of the last working window that finished at or before an instant. */
function previousWorkingEnd(before: number, settings: TimeSettings): number | undefined {
  let cursor = noonOf(before, settings.timezone);
  for (let day = 0; day <= SCAN_DAYS; day++, cursor -= DAY_MS) {
    const window = windowFor(cursor, settings);
    if (window && window.end <= before) return window.end;
  }
  return undefined;
}

/**
 * The non-working stretch that has not ended yet: the one `now` sits in, or the one that opens when
 * today's working hours close. Its start names the working day the night belongs to.
 */
export function overnightWindow(now: number, settings: TimeSettings) {
  const end = nextWorkingStart(now, settings);
  if (end === undefined) return undefined;
  const start = previousWorkingEnd(end, settings);
  return start === undefined ? undefined : { start, end };
}

/** Days a single span may cover. Past this a deadline is too far away for the hours to matter. */
const MAX_SPAN_DAYS = 420;

/** Working hours between two instants, counting only time inside the working windows they span. */
export function workingHoursBetween(from: number, to: number, settings: TimeSettings) {
  if (!(to > from)) return 0;
  let total = 0;
  let cursor = noonOf(from, settings.timezone);
  for (let day = 0; day <= MAX_SPAN_DAYS && cursor < to + DAY_MS; day++, cursor += DAY_MS) {
    const window = windowFor(cursor, settings);
    if (!window) continue;
    total += Math.max(0, Math.min(window.end, to) - Math.max(window.start, from));
  }
  return total / HOUR_MS;
}
