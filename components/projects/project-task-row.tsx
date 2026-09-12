'use client';

import { PlayCircle } from 'lucide-react';
import { statusLabel } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { dateInputTime, dateInputValue } from '../shared/time';
import type { ProjectTask } from '@/lib/contracts';

/**
 * One task of a project: what it is, who holds it, when it is due, how often it runs, and — while it
 * waits or is blocked — the work it is waiting for and the control that releases it.
 */
export function ProjectTaskRow({
  task,
  waitingFor,
  busy,
  onOpen,
  onDeadline,
  onCadence,
  onUnblock,
}: {
  task: ProjectTask;
  /** The titles of the tasks this one depends on, in the order it names them. */
  waitingFor: string[];
  busy: boolean;
  onOpen: (taskId: string) => void;
  onDeadline: (taskId: string, deadlineAt?: number) => void;
  onCadence: (taskId: string, cadence: 'once' | 'daily') => void;
  onUnblock: (taskId: string) => void;
}) {
  return (
    <li className="project-task" data-status={task.status}>
      <button className="project-task-open" onClick={() => onOpen(task.id)}>
        <StatusMark status={task.status} />
        <span>
          <strong>{task.title}</strong>
          <small>
            {task.employeeName} · {statusLabel(task.status)}
          </small>
        </span>
      </button>
      <div className="project-task-controls">
        <label>
          <span className="sr-only">Deadline for {task.title}</span>
          <input
            type="date"
            value={dateInputValue(task.deadlineAt)}
            disabled={busy}
            onChange={(event) => onDeadline(task.id, dateInputTime(event.target.value))}
          />
        </label>
        <label>
          <span className="sr-only">Cadence for {task.title}</span>
          <select
            value={task.cadence}
            disabled={busy}
            onChange={(event) => onCadence(task.id, event.target.value === 'daily' ? 'daily' : 'once')}
          >
            <option value="once">Once</option>
            <option value="daily">Daily</option>
          </select>
        </label>
      </div>
      {waitingFor.length > 0 && (
        <p className="project-task-waiting">
          Waiting on {waitingFor.join(', ')}
          {task.error ? ` · ${task.error}` : ''}
        </p>
      )}
      {task.status === 'blocked' && (
        <button className="text-button" disabled={busy} onClick={() => onUnblock(task.id)}>
          <PlayCircle size={15} />
          Run it anyway
        </button>
      )}
    </li>
  );
}
