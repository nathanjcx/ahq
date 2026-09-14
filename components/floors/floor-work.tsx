'use client';

import { ChevronRight, Clock, Plus } from 'lucide-react';
import { statusLabel } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { relativeTime, shortDate } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import type { ActionProposal, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import { uiApi } from '@/lib/ui-api';

const HELD: Partial<Record<Task['status'], string>> = {
  waiting: 'Waiting on a dependency',
  blocked: 'Blocked',
};

/** Nearest deadline first; work without one follows, newest first. */
function byDeadline(a: Task, b: Task) {
  if (a.deadlineAt !== b.deadlineAt) return (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity);
  return b.updatedAt - a.updatedAt;
}

/**
 * The floor's work, grouped by the project it serves, because a floor's week is several projects
 * pulling on the same instances. Deadlines and held work are the two things a person scans for.
 */
export function FloorWork({
  tasks,
  proposals,
  canAssign,
  onTask,
  onNewTask,
}: {
  tasks: Task[];
  proposals: ActionProposal[];
  canAssign: boolean;
  onTask: (id: string) => void;
  onNewTask: () => void;
}) {
  const projects = useUiQuery(uiApi.projects, {});
  const pendingByTask = new Map<string, number>();
  for (const proposal of proposals)
    if (proposal.status === 'pending')
      pendingByTask.set(proposal.taskId, (pendingByTask.get(proposal.taskId) ?? 0) + 1);

  const groups = new Map<string, { title: string; tasks: Task[] }>();
  for (const task of tasks) {
    const key = task.projectId ?? '';
    const title = task.projectId
      ? (projects?.find((project) => project.id === task.projectId)?.name ?? 'Project work')
      : 'Floor work';
    const group = groups.get(key) ?? { title, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0));

  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">WORK ON THIS FLOOR</span>
          <h3>{pluralize(tasks.length, 'task')}</h3>
        </div>
        <button className="secondary-button compact" disabled={!canAssign} onClick={onNewTask}>
          <Plus size={14} /> Assign work
        </button>
      </div>
      {ordered.length === 0 ? (
        <p className="floor-work-empty">Nothing is assigned to this floor yet.</p>
      ) : (
        <div className="floor-work-groups">
          {ordered.map(([key, group]) => (
            <section key={key} className="floor-work-group">
              <h4>
                {group.title} <span>{group.tasks.length}</span>
              </h4>
              <div className="floor-work-list">
                {[...group.tasks].sort(byDeadline).map((task) => {
                  const pending = pendingByTask.get(task.id) ?? 0;
                  const held = HELD[task.status];
                  return (
                    <button key={task.id} onClick={() => onTask(task.id)}>
                      <StatusMark status={task.status} />
                      <span>
                        <strong>{task.title}</strong>
                        <small>
                          {task.employeeName}
                          {task.cadence === 'daily' && ' · daily'} · {statusLabel(task.status)} ·{' '}
                          {relativeTime(task.updatedAt)}
                        </small>
                      </span>
                      {held && <span className="work-held">{held}</span>}
                      {task.deadlineAt !== undefined && (
                        <span className="work-deadline" data-late={task.deadlineAt < Date.now()}>
                          <Clock size={12} /> {shortDate(task.deadlineAt)}
                        </span>
                      )}
                      {pending > 0 && (
                        <span className="tab-badge" title="Actions waiting for review">
                          {pending}
                        </span>
                      )}
                      <ChevronRight size={13} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
