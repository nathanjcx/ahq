import type { OfficeEvent, OfficeRecordingBounds, OfficeReplayBundle } from '../../shared/office-events';

export const REPLAY_SPEEDS = [1, 10, 30, 60, 100, 300] as const;

export function selectReplayBundle(
  at: number | null,
  live: OfficeReplayBundle | null,
  past: OfficeReplayBundle | null,
): OfficeReplayBundle | null {
  return at === null ? live : past?.requestedAt === at ? past : null;
}

export function clampReplayTime(time: number, bounds: OfficeRecordingBounds): number | null {
  if (!Number.isFinite(time) || bounds.firstAt === null || bounds.lastAt === null) return null;
  return Math.round(Math.max(bounds.firstAt, Math.min(bounds.lastAt, time)));
}

// A late-recorded or future-dated claim cannot be visible before both timestamps.
export function replayEventTime(event: Pick<OfficeEvent, 'recordedAt' | 'occurredAt'>): number {
  return Math.max(Date.parse(event.recordedAt), Date.parse(event.occurredAt));
}

export function stepReplayEvent(events: OfficeEvent[], at: number, direction: -1 | 1): number | null {
  const times = events.map(replayEventTime).filter(Number.isFinite);
  const candidates = times.filter((time) => (direction < 0 ? time < at : time > at));
  if (!candidates.length) return null;
  return direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
}

export function advanceReplayTime(
  start: number,
  elapsedMs: number,
  speed: number,
  bounds: OfficeRecordingBounds,
): number | null {
  return clampReplayTime(start + Math.max(0, elapsedMs) * speed, bounds);
}
