'use client';

import { ChevronRight, Plus } from 'lucide-react';
import type { ActionProposal, Task } from '@/lib/contracts';
import { relativeTime, statusLabel } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { taskGroup, type TaskGroup } from './floor-stats';

const GROUPS: { id: TaskGroup; title: string; empty: string }[] = [
  { id: 'active', title: 'Active', empty: 'Nothing running on this floor.' },
  { id: 'awaiting', title: 'Awaiting approval', empty: 'No action is waiting on a review.' },
  { id: 'done', title: 'Done', empty: 'Finished work will collect here.' },
];

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
  const pendingByTask = new Map<string, number>();
  for (const proposal of proposals)
    if (proposal.status === 'pending')
      pendingByTask.set(proposal.taskId, (pendingByTask.get(proposal.taskId) ?? 0) + 1);

  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">WORK ON THIS FLOOR</span>
          <h3>
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
          </h3>
        </div>
        <button className="secondary-button compact" disabled={!canAssign} onClick={onNewTask}>
          <Plus size={14} /> Assign work
        </button>
      </div>
      <div className="work-groups">
        {GROUPS.map((group) => {
          const groupTasks = tasks
            .filter((task) => taskGroup(task.status) === group.id)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          return (
            <section key={group.id} className="work-group">
              <h4>
                {group.title} <span>{groupTasks.length}</span>
              </h4>
              {groupTasks.length ? (
                <div className="work-list">
                  {groupTasks.map((task) => {
                    const pending = pendingByTask.get(task.id) ?? 0;
                    return (
                      <button key={task.id} onClick={() => onTask(task.id)}>
                        <StatusMark status={task.status} />
                        <span>
                          <strong>{task.title}</strong>
                          <small>
                            {task.employeeName}
                            {!task.isOwner && ` · for ${task.createdByName}`} · {statusLabel(task.status)} ·{' '}
                            {relativeTime(task.updatedAt)}
                          </small>
                        </span>
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
              ) : (
                <p className="work-empty">{group.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
