/**
 * Clock and calendar text for the interface. These read the viewer's locale and the browser's own
 * clock; the workspace's schedule arithmetic lives in `lib/time.ts` and takes its zone explicitly.
 */

/** Which part of the day it is for the viewer, for a greeting. */
export function timeGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/** "Mar 4": the date without a year, for something recent. */
export function shortDate(at: number) {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** What a `<input type="date">` shows for a moment, in the viewer's own zone; empty for none. */
export function dateInputValue(at?: number) {
  if (at === undefined) return '';
  const local = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

/** A date input's value as a moment: midday, so a timezone cannot move it to the day before. */
export function dateInputTime(value: string) {
  const at = new Date(`${value}T12:00:00`).getTime();
  return Number.isNaN(at) ? undefined : at;
}

/** "2:32 PM", or "14:32" where the viewer's locale uses a 24-hour clock. */
export function shortTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * How long ago something happened, in the shortest form that still says it: "just now", "12m ago",
 * "3h ago", "2d ago", and a date once a week has passed.
 */
export function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : shortDate(timestamp);
}

/** How long something took: "820 ms", "1.4 s", "3m 20s", "2h 15m". */
export function durationLabel(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * A whole hour of the working day as the workspace reads it: "9 AM". A viewer whose own zone is not
 * the workspace's gets the zone named too — "9 AM EST" — because the hour is not theirs.
 */
export function hourLabel(hour: number, timezone: string) {
  const at = Date.UTC(2001, 0, 1, ((hour % 24) + 24) % 24);
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(at);
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === timezone) return clock;
  const zone = new Intl.DateTimeFormat(undefined, { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(Date.now())
    .find((part) => part.type === 'timeZoneName')?.value;
  return zone ? `${clock} ${zone}` : clock;
}
