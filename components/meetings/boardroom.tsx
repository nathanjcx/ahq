'use client';

import { useMemo } from 'react';
import { deriveActivities, deriveFloorSignals, type DayInput } from '../office/activity';
import type { OfficeSceneData } from '../office/office-stage';
import type { OfficeEmployee } from '../office/office-view';
import { RoomView } from '../office/room-view';
import { useNow } from '../office/use-day';
import type { CalendarEntry, Employee, Meeting } from '@/lib/contracts';

/**
 * The top-floor boardroom: the attendees round the table, the one with the floor
 * a little out of their chair, and a speech mark over the room while the meeting
 * is open. Everything comes from the transcript the page is already reading, so
 * the room and the text can never disagree.
 */
export function Boardroom({
  entry,
  meeting,
  employees,
}: {
  entry: CalendarEntry;
  meeting: Meeting | null | undefined;
  /** The workspace's instances, for the attendees' own colours. */
  employees: Employee[];
}) {
  const attendees = useMemo(
    () =>
      entry.attendees.flatMap((attendee) =>
        attendee.kind === 'employee' ? [{ id: attendee.id, name: attendee.name }] : [],
      ),
    [entry.attendees],
  );
  const people: OfficeEmployee[] = useMemo(
    () =>
      attendees.map((attendee) => {
        const employee = employees.find((item) => item.id === attendee.id);
        return {
          id: attendee.id,
          name: attendee.name,
          role: employee?.role ?? 'Attendee',
          status: 'working',
          ...(employee?.color ? { color: employee.color } : {}),
          ...(employee?.kind && employee.kind !== 'worker' ? { kind: employee.kind } : {}),
        };
      }),
    [attendees, employees],
  );
  const now = useNow(5_000);
  const scene: OfficeSceneData = useMemo(() => {
    const day: DayInput = { meetings: [{ entry, ...(meeting ? { meeting } : {}) }] };
    const signals = deriveFloorSignals(day, undefined, now);
    return {
      activities: deriveActivities({
        employees: attendees,
        tasks: [],
        events: [],
        proposals: [],
        posts: [],
        now,
        day,
      }),
      providers: [],
      lightBudget: 0,
      room: 'boardroom',
      ...(signals.meeting ? { meeting: signals.meeting } : {}),
    };
  }, [entry, meeting, attendees, now]);
  if (!people.length) return null;

  // Whether anybody is in the room: attendees ride the lift up an hour before.
  const seated = Boolean(scene.meeting);
  const live = scene.meeting?.live;
  return (
    <RoomView
      title="Boardroom"
      note={
        live
          ? 'In session. Whoever answered last has the floor.'
          : seated
            ? 'The attendees are gathering. Open the room to start.'
            : 'The room is empty until an hour before the meeting.'
      }
      employees={people}
      scene={scene}
    />
  );
}
