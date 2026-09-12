import { describe, expect, it } from 'vitest';
import {
  dateKey,
  isAttendedTime,
  isValidTimezone,
  isWorkingTime,
  localParts,
  nextWorkingStart,
  overnightWindow,
  startOfDay,
  workingHoursBetween,
  type TimeSettings,
} from '../lib/time';

const newYork: TimeSettings = {
  timezone: 'America/New_York',
  workingDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
  attendedStartHour: 10,
  attendedEndHour: 16,
};
const berlin: TimeSettings = { ...newYork, timezone: 'Europe/Berlin' };
const at = (iso: string) => Date.parse(iso);

describe('local clock readings', () => {
  it('reads the same instant differently in two zones', () => {
    // 2026-06-01 23:30 UTC is still June 1 in New York and already June 2 in Berlin.
    const instant = at('2026-06-01T23:30:00Z');
    expect(localParts(instant, 'America/New_York')).toMatchObject({ hour: 19, minute: 30, weekday: 1 });
    expect(dateKey(instant, 'America/New_York')).toBe('2026-06-01');
    expect(localParts(instant, 'Europe/Berlin')).toMatchObject({ hour: 1, minute: 30, weekday: 2 });
    expect(dateKey(instant, 'Europe/Berlin')).toBe('2026-06-02');
  });

  it('keeps midnight local across both DST transitions', () => {
    // New York springs forward on 2026-03-08 and falls back on 2026-11-01.
    expect(startOfDay(at('2026-03-08T18:00:00Z'), 'America/New_York')).toBe(at('2026-03-08T05:00:00Z'));
    expect(startOfDay(at('2026-11-01T18:00:00Z'), 'America/New_York')).toBe(at('2026-11-01T04:00:00Z'));
    // Berlin springs forward on 2026-03-29 and falls back on 2026-10-25.
    expect(startOfDay(at('2026-03-29T12:00:00Z'), 'Europe/Berlin')).toBe(at('2026-03-28T23:00:00Z'));
    expect(startOfDay(at('2026-10-25T12:00:00Z'), 'Europe/Berlin')).toBe(at('2026-10-24T22:00:00Z'));
  });

  it('rejects a zone this runtime does not know', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('working and attended hours', () => {
  it('opens and closes on the local hour, not the UTC hour', () => {
    // Monday 2026-06-01: 09:00 New York is 13:00 UTC in summer time.
    expect(isWorkingTime(at('2026-06-01T12:59:00Z'), newYork)).toBe(false);
    expect(isWorkingTime(at('2026-06-01T13:00:00Z'), newYork)).toBe(true);
    expect(isWorkingTime(at('2026-06-01T21:59:00Z'), newYork)).toBe(true);
    expect(isWorkingTime(at('2026-06-01T22:00:00Z'), newYork)).toBe(false);
    // The same wall clock in Berlin is 07:00 to 16:00 UTC in summer time.
    expect(isWorkingTime(at('2026-06-01T06:59:00Z'), berlin)).toBe(false);
    expect(isWorkingTime(at('2026-06-01T07:00:00Z'), berlin)).toBe(true);
  });

  it('follows the zone across a DST change rather than drifting by an hour', () => {
    // 09:00 New York is 14:00 UTC in winter and 13:00 UTC in summer.
    expect(isWorkingTime(at('2026-03-06T14:00:00Z'), newYork)).toBe(true);
    expect(isWorkingTime(at('2026-03-06T13:00:00Z'), newYork)).toBe(false);
    expect(isWorkingTime(at('2026-03-09T13:00:00Z'), newYork)).toBe(true);
  });

  it('keeps weekends and attended hours out', () => {
    expect(isWorkingTime(at('2026-06-06T16:00:00Z'), newYork)).toBe(false);
    expect(isAttendedTime(at('2026-06-01T13:30:00Z'), newYork)).toBe(false);
    expect(isAttendedTime(at('2026-06-01T14:30:00Z'), newYork)).toBe(true);
    expect(isAttendedTime(at('2026-06-01T20:30:00Z'), newYork)).toBe(false);
  });
});

describe('the next working window', () => {
  it('returns today before the bell and tomorrow once the day has opened', () => {
    expect(nextWorkingStart(at('2026-06-01T11:00:00Z'), newYork)).toBe(at('2026-06-01T13:00:00Z'));
    expect(nextWorkingStart(at('2026-06-01T15:00:00Z'), newYork)).toBe(at('2026-06-02T13:00:00Z'));
  });

  it('skips the weekend and lands on the local hour after a DST change', () => {
    expect(nextWorkingStart(at('2026-06-06T15:00:00Z'), newYork)).toBe(at('2026-06-08T13:00:00Z'));
    // Friday 2026-03-06 is winter time; the following Monday is already summer time.
    expect(nextWorkingStart(at('2026-03-06T23:00:00Z'), newYork)).toBe(at('2026-03-09T13:00:00Z'));
    expect(nextWorkingStart(at('2026-03-27T23:00:00Z'), berlin)).toBe(at('2026-03-30T07:00:00Z'));
  });

  it('gives up when no day is worked', () => {
    expect(nextWorkingStart(at('2026-06-01T11:00:00Z'), { ...newYork, workingDays: [] })).toBeUndefined();
  });
});

describe('the overnight window', () => {
  it('runs from the last close to the next open, whichever side of midnight it is asked from', () => {
    const night = { start: at('2026-06-01T22:00:00Z'), end: at('2026-06-02T13:00:00Z') };
    expect(overnightWindow(at('2026-06-01T16:00:00Z'), newYork)).toEqual(night);
    expect(overnightWindow(at('2026-06-01T23:00:00Z'), newYork)).toEqual(night);
    expect(overnightWindow(at('2026-06-02T05:00:00Z'), newYork)).toEqual(night);
    expect(dateKey(night.start, newYork.timezone)).toBe('2026-06-01');
  });

  it('spans the whole weekend', () => {
    expect(overnightWindow(at('2026-06-06T12:00:00Z'), newYork)).toEqual({
      start: at('2026-06-05T22:00:00Z'),
      end: at('2026-06-08T13:00:00Z'),
    });
  });
});

describe('working hours between two instants', () => {
  it('counts only the hours inside the windows it spans', () => {
    expect(workingHoursBetween(at('2026-06-01T13:00:00Z'), at('2026-06-01T22:00:00Z'), newYork)).toBe(9);
    expect(workingHoursBetween(at('2026-06-01T16:00:00Z'), at('2026-06-02T16:00:00Z'), newYork)).toBe(9);
    // Friday afternoon to Monday afternoon is Friday's remainder plus Monday's opening hours.
    expect(workingHoursBetween(at('2026-06-05T20:00:00Z'), at('2026-06-08T16:00:00Z'), newYork)).toBe(5);
    expect(workingHoursBetween(at('2026-06-08T16:00:00Z'), at('2026-06-05T20:00:00Z'), newYork)).toBe(0);
  });

  it('loses an hour on the spring-forward day and gains one in the autumn', () => {
    // One calendar day of a workspace that works round the clock is 23, 24, or 25 real hours.
    const roundTheClock = { ...newYork, startHour: 0, endHour: 24, workingDays: [0, 1, 2, 3, 4, 5, 6] };
    const wholeDay = (from: string, to: string, settings: TimeSettings) =>
      workingHoursBetween(
        startOfDay(at(from), settings.timezone),
        startOfDay(at(to), settings.timezone),
        settings,
      );
    expect(wholeDay('2026-03-08T18:00:00Z', '2026-03-09T18:00:00Z', roundTheClock)).toBe(23);
    expect(wholeDay('2026-11-01T18:00:00Z', '2026-11-02T18:00:00Z', roundTheClock)).toBe(25);
    expect(wholeDay('2026-06-01T18:00:00Z', '2026-06-02T18:00:00Z', roundTheClock)).toBe(24);
    const berlinClock = { ...roundTheClock, timezone: berlin.timezone };
    expect(wholeDay('2026-03-29T12:00:00Z', '2026-03-30T12:00:00Z', berlinClock)).toBe(23);
    expect(wholeDay('2026-10-25T12:00:00Z', '2026-10-26T12:00:00Z', berlinClock)).toBe(25);
  });
});
