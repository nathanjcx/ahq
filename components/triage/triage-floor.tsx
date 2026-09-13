'use client';

import { useMemo } from 'react';
import { deriveActivities, deriveFloorSignals, type DayInput } from '../office/activity';
import type { OfficeSceneData } from '../office/office-stage';
import type { OfficeEmployee } from '../office/office-view';
import { RoomView } from '../office/room-view';
import { useNow } from '../office/use-day';
import type { Alert, Employee, Notification, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

const RUNNING: Task['status'][] = ['queued', 'running', 'awaiting_approval'];

/**
 * The reserved Triage floor: the alert board lit once per open incident, the
 * status lamp beside it, and the beacon while anything is open. The engineers are
 * at a console for as long as their run is, which is the same rule the working
 * floors use.
 */
export function TriageFloor({
  employees,
  tasks,
  alerts,
  notifications,
}: {
  employees: Employee[];
  tasks: Task[];
  alerts: Alert[];
  /** The ledger, so a fix made without permission leaves its notice by the door. */
  notifications: Notification[];
}) {
  const staff = useMemo(() => employees.filter((employee) => employee.kind === 'triage'), [employees]);
  const runs = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.kind === 'triage' &&
          RUNNING.includes(task.status) &&
          staff.some((employee) => employee.id === task.employeeId),
      ),
    [tasks, staff],
  );
  const people: OfficeEmployee[] = useMemo(
    () =>
      staff.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        status: runs.some((task) => task.employeeId === employee.id) ? 'working' : 'ready',
        color: employee.color,
        kind: 'triage' as const,
      })),
    [staff, runs],
  );
  const now = useNow(5_000);
  const scene: OfficeSceneData = useMemo(() => {
    const day: DayInput = { alerts, notifications };
    const signals = deriveFloorSignals(day, undefined, now);
    return {
      activities: deriveActivities({
        employees: staff,
        tasks: runs,
        events: [],
        proposals: [],
        posts: [],
        now,
        day,
      }),
      providers: [],
      lightBudget: 0,
      hour: new Date(now).getHours(),
      room: 'triage',
      ...(signals.incident ? { incident: true, incidentCount: signals.incidentCount } : {}),
      ...(signals.emergency ? { emergency: signals.emergency } : {}),
    };
  }, [staff, runs, alerts, notifications, now]);
  if (!people.length) return null;

  const open = scene.incidentCount ?? 0;
  return (
    <RoomView
      title="Triage floor"
      note={
        open
          ? `The board is lit: ${pluralize(open, 'open incident')}.`
          : 'No open alerts.'
      }
      employees={people}
      scene={scene}
    />
  );
}
