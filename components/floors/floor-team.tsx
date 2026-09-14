'use client';

import { Plus, Users } from 'lucide-react';
import { EmptyMini } from '../shared/empty';
import { Avatar } from '../shared/marks';
import type { Employee, ScheduleSummary, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

type Shift = { label: string; tone: 'working' | 'review' | 'held' | 'idle'; detail?: string };

/**
 * Where one instance is in its day. An instance runs one shift at a time, so its live task is its
 * shift; outside the workspace's working hours nobody is on one.
 */
export function shiftFor(employee: Employee, tasks: Task[], schedule?: ScheduleSummary): Shift {
  const mine = tasks.filter((task) => task.employeeId === employee.id);
  const running = mine.find((task) => task.status === 'running');
  if (running) return { label: 'On shift', tone: 'working', detail: running.title };
  const review = mine.find((task) => task.status === 'awaiting_approval' || task.status === 'needs_input');
  if (review) return { label: 'Waiting on you', tone: 'review', detail: review.title };
  const held = mine.find((task) => task.status === 'waiting' || task.status === 'blocked');
  if (held)
    return { label: held.status === 'waiting' ? 'Waiting' : 'Blocked', tone: 'held', detail: held.title };
  const queued = mine.filter((task) => task.status === 'queued');
  if (queued.length) return { label: 'Queued', tone: 'working', detail: pluralize(queued.length, 'task') };
  if (employee.status !== 'ready') return { label: employee.status, tone: 'held' };
  if (schedule && !schedule.working) return { label: 'Off shift', tone: 'idle' };
  return { label: 'Ready', tone: 'idle' };
}

/** The people on a floor (or in the lobby), grouped by version, each with where it is in its day. */
export function FloorTeamList({
  staff,
  tasks,
  schedule,
  canAssign,
  emptyTitle,
  emptyText,
  onEmployee,
  onNewTask,
}: {
  staff: Employee[];
  /** The tasks an instance's shift status is read from. */
  tasks: Task[];
  schedule?: ScheduleSummary;
  canAssign: boolean;
  emptyTitle: string;
  emptyText: string;
  onEmployee: (id: string) => void;
  onNewTask: (employeeId: string) => void;
}) {
  if (!staff.length) return <EmptyMini icon={<Users size={19} />} title={emptyTitle} text={emptyText} />;
  // Hiring the same employee again makes another instance, so the team reads by version first.
  const versions = new Map<string, Employee[]>();
  for (const employee of staff)
    versions.set(employee.versionId, [...(versions.get(employee.versionId) ?? []), employee]);
  return (
    <div className="floor-team-versions">
      {[...versions.values()].map((instances) => (
        <section key={instances[0].versionId} className="floor-team-version">
          <h4>
            {instances[0].instanceOf} <span>v{instances[0].version}</span>
            <small>{pluralize(instances.length, 'instance')}</small>
          </h4>
          <div className="floor-team-list">
            {instances.map((employee) => {
              const shift = shiftFor(employee, tasks, schedule);
              return (
                <div key={employee.id} className="team-row">
                  <button className="team-open" onClick={() => onEmployee(employee.id)}>
                    <Avatar employee={employee} />
                    <span>
                      <strong>{employee.name}</strong>
                      <small>{shift.detail ?? employee.role}</small>
                    </span>
                    <span className="shift-pill" data-tone={shift.tone}>
                      {shift.label}
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    title={`Assign work to ${employee.name}`}
                    aria-label={`Assign work to ${employee.name}`}
                    disabled={!canAssign || employee.status !== 'ready'}
                    onClick={() => onNewTask(employee.id)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
