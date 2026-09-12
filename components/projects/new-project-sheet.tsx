'use client';

import { useState } from 'react';
import { Sheet } from '../shared/sheet';
import type { Employee, Floor } from '@/lib/contracts';

/**
 * A project is created with a name, a brief, and its floors; the planner reads the brief and comes
 * back with a roadmap. The deadline and the staff suggestions are written into the brief, in the
 * words the planner will read, because they are instructions to it rather than fields of the project.
 */
function composeBrief(goal: string, deadline: string, suggested: Employee[]) {
  const lines = [goal.trim()];
  if (deadline) lines.push(`Deadline: ${new Date(`${deadline}T12:00:00`).toDateString()}.`);
  if (suggested.length)
    lines.push(`Suggested staff: ${suggested.map((employee) => employee.name).join(', ')}.`);
  return lines.filter(Boolean).join('\n\n');
}

export function NewProjectSheet({
  floors,
  employees,
  busy,
  onClose,
  onCreate,
}: {
  floors: Floor[];
  employees: Employee[];
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, brief: string, floorIds: string[]) => void;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [deadline, setDeadline] = useState('');
  const [floorIds, setFloorIds] = useState<string[]>([]);
  const [staff, setStaff] = useState<string[]>([]);

  // Who is on the chosen floors. A floor holds its staff, so the floor is the thing to read.
  const staffed = new Set(
    floors.filter((floor) => floorIds.includes(floor.id)).flatMap((floor) => floor.employeeIds),
  );
  const onFloors = employees.filter((employee) => staffed.has(employee.id));
  const suggested = onFloors.filter((employee) => staff.includes(employee.id));
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
  const ready = Boolean(name.trim() && goal.trim() && floorIds.length) && !busy;

  return (
    <Sheet
      title="New project"
      subtitle="Say what has to be true when this is done. The planner proposes the roadmap."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!ready}
            onClick={() => onCreate(name.trim(), composeBrief(goal, deadline, suggested), floorIds)}
          >
            {busy ? 'Creating…' : 'Create and plan'}
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Spring launch" />
        </label>
        <label>
          Goal
          <small>What has to be true when the project is finished.</small>
          <textarea
            className="large-textarea"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Ship the March release: changelog, migration notes, and the customer announcement."
          />
        </label>
        <label>
          Deadline
          <small>Optional. The planner works back from it when it lays out the milestones.</small>
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        <fieldset className="project-picker">
          <legend>Floors</legend>
          <small>A project spans the floors that do its work.</small>
          <div className="project-options">
            {floors.map((floor) => (
              <label key={floor.id} data-checked={floorIds.includes(floor.id)}>
                <input
                  type="checkbox"
                  checked={floorIds.includes(floor.id)}
                  onChange={() => setFloorIds((current) => toggle(current, floor.id))}
                />
                <span>
                  <strong>{floor.name}</strong>
                  <small>{floor.brief}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {onFloors.length > 0 && (
          <fieldset className="project-picker">
            <legend>Suggested staff</legend>
            <small>Optional. The planner staffs the roadmap itself unless you name people.</small>
            <div className="project-options">
              {onFloors.map((employee) => (
                <label key={employee.id} data-checked={staff.includes(employee.id)}>
                  <input
                    type="checkbox"
                    checked={staff.includes(employee.id)}
                    onChange={() => setStaff((current) => toggle(current, employee.id))}
                  />
                  <span>
                    <strong>{employee.name}</strong>
                    <small>{employee.role}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Sheet>
  );
}
