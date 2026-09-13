'use client';

import { CalendarClock, Pencil, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { OfficeDay } from '../office/office-day';
import type { OfficeSceneData } from '../office/office-stage';
import type { OfficeEmployee } from '../office/office-view';
import { useLabelMode } from '../office/use-labels';
import { EmptyMini } from '../shared/empty';
import { Avatar } from '../shared/marks';
import { FloorReplay } from './floor-replay';
import { FloorScene } from './floor-scene';
import type { Employee, ScheduleSummary, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

type Shift = { label: string; tone: 'working' | 'review' | 'held' | 'idle'; detail?: string };

/**
 * Where one instance is in its day. An instance runs one shift at a time, so its live task is its
 * shift; outside the workspace's working hours nobody is on one.
 */
function shiftFor(employee: Employee, tasks: Task[], schedule?: ScheduleSummary): Shift {
  const mine = tasks.filter((task) => task.employeeId === employee.id);
  const running = mine.find((task) => task.status === 'running');
  if (running) return { label: 'On shift', tone: 'working', detail: running.title };
  const review = mine.find((task) => task.status === 'awaiting_approval');
  if (review) return { label: 'Waiting on you', tone: 'review', detail: review.title };
  const held = mine.find((task) => task.status === 'waiting' || task.status === 'blocked');
  if (held) return { label: held.status === 'waiting' ? 'Waiting' : 'Blocked', tone: 'held', detail: held.title };
  const queued = mine.filter((task) => task.status === 'queued');
  if (queued.length) return { label: 'Queued', tone: 'working', detail: pluralize(queued.length, 'task') };
  if (employee.status !== 'ready') return { label: employee.status, tone: 'held' };
  if (schedule && !schedule.working) return { label: 'Off shift', tone: 'idle' };
  return { label: 'Ready', tone: 'idle' };
}

export function FloorTeam({
  floorName,
  floorId,
  configured,
  archived,
  staff,
  tasks,
  schedule,
  officeEmployees,
  canAssign,
  onEmployee,
  onNewTask,
  onEditFloor,
}: {
  floorName: string;
  /** This floor, so the office can read its board and replay its finished tasks. */
  floorId: string;
  /** Whether a Convex client exists. */
  configured: boolean;
  archived: boolean;
  staff: Employee[];
  /** This floor's tasks, which is where an instance's shift status comes from. */
  tasks: Task[];
  schedule?: ScheduleSummary;
  officeEmployees: OfficeEmployee[];
  canAssign: boolean;
  onEmployee: (id: string) => void;
  onNewTask: (employeeId: string) => void;
  onEditFloor: () => void;
}) {
  const [replay, setReplay] = useState<OfficeSceneData | undefined>(undefined);
  const [dayOpen, setDayOpen] = useState(false);
  const labels = useLabelMode();
  // Hiring the same employee again makes another instance, so the team reads by version first.
  const versions = new Map<string, Employee[]>();
  for (const employee of staff)
    versions.set(employee.versionId, [...(versions.get(employee.versionId) ?? []), employee]);

  return (
    <>
      <FloorScene
        label={floorName}
        archived={archived}
        compact
        floorId={floorId}
        live={configured}
        scene={replay}
        stage={
          dayOpen ? (
            <OfficeDay
              employees={officeEmployees}
              floorId={floorId}
              label={floorName}
              labels={labels.mode}
              tasks={tasks}
              schedule={schedule}
              onSelect={onEmployee}
            />
          ) : undefined
        }
        controls={
          <>
            <FloorReplay
              floorId={floorId}
              live={configured && !archived && !dayOpen}
              defaultEmployeeId={staff[0]?.id}
              onScene={setReplay}
            />
            <button
              type="button"
              className="floor-replay-toggle"
              aria-pressed={dayOpen}
              disabled={!configured || archived || replay !== undefined}
              onClick={() => setDayOpen((open) => !open)}
            >
              <CalendarClock size={12} />
              Replay the day
            </button>
          </>
        }
        employeeCount={staff.length}
        officeEmployees={officeEmployees}
        emptyMessage={
          staff.length
            ? 'This team needs its connections set up. Select an employee to review access.'
            : 'This floor is ready. Edit the floor to add its floor team.'
        }
        onEmployee={onEmployee}
      />
      <div className="floor-team">
        <div className="section-title">
          <div>
            <span className="eyebrow">STAFFING</span>
            <h3>Floor team</h3>
          </div>
          <span className="staff-count">{staff.length}</span>
        </div>
        {staff.length ? (
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
        ) : (
          <EmptyMini
            icon={<Users size={19} />}
            title="No one staffed yet"
            text="Edit this floor to add one or more employees."
          />
        )}
        <button className="floor-team-edit" onClick={onEditFloor}>
          <Pencil size={14} /> {archived ? 'Manage floor' : 'Edit staffing'}
        </button>
      </div>
    </>
  );
}
