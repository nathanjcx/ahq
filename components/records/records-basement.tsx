'use client';

import { useMemo } from 'react';
import { deriveActivities } from '../office/activity';
import type { OfficeSceneData } from '../office/office-stage';
import type { OfficeEmployee } from '../office/office-view';
import { RoomView } from '../office/room-view';
import { useNow } from '../office/use-day';
import { useRecordsShelves } from '../office/use-memory';
import type { Employee, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

/** The runs that put somebody in the basement: the janitor's curation pass. */
const CURATING: Task['status'][] = ['queued', 'running', 'awaiting_approval'];

/**
 * The records room itself, above the shelves it stands for: one run of casework
 * per scope, filled to its budget, with red binders where two claims disagree.
 * The janitor is at the desk while a curation run is open, and the room is empty
 * the rest of the time.
 */
export function RecordsBasement({ employees, tasks }: { employees: Employee[]; tasks: Task[] }) {
  const shelves = useRecordsShelves();
  const curating = useMemo(
    () => tasks.filter((task) => task.kind === 'curation' && CURATING.includes(task.status)),
    [tasks],
  );
  const janitors = useMemo(
    () =>
      employees.filter(
        (employee) => employee.kind === 'janitor' && curating.some((task) => task.employeeId === employee.id),
      ),
    [employees, curating],
  );
  const people: OfficeEmployee[] = useMemo(
    () =>
      janitors.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        status: 'working',
        color: employee.color,
        kind: 'janitor' as const,
      })),
    [janitors],
  );
  const now = useNow(60_000);
  const scene: OfficeSceneData = useMemo(
    () => ({
      activities: deriveActivities({
        employees: janitors,
        tasks: curating,
        events: [],
        proposals: [],
        posts: [],
        now,
      }),
      providers: [],
      lightBudget: 0,
      room: 'records',
      records: { shelves: shelves ?? [] },
    }),
    [shelves, janitors, curating, now],
  );
  // Until the summaries answer there is nothing to stand casework for.
  if (!shelves?.length) return null;

  const contested = shelves.reduce((total, shelf) => total + shelf.contested, 0);
  return (
    <RoomView
      title="Records room"
      note={
        `${pluralize(shelves.length, 'run')} of casework` +
        (contested ? `, ${pluralize(contested, 'claim')} in dispute` : '') +
        (people.length ? '. The janitor is curating.' : '.')
      }
      employees={people}
      scene={scene}
    />
  );
}
