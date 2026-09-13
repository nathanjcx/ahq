'use client';

import { ListTodo, Plus } from 'lucide-react';
import { useState } from 'react';
import { EmptyPane, EmptySection } from '../shared/empty';
import { StatusMark } from '../shared/marks';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { relativeTime } from '../shared/time';
import { TaskDetail } from './task-detail';
import type { ActionProposal, Employee, Floor, Task, TaskVisibility } from '@/lib/contracts';
import { pluralize } from '@/lib/text';
import './tasks.css';

export function taskFloorName(task: Task, floors: Floor[]) {
  return task.floorContext?.name ?? floors.find((floor) => floor.id === task.floorId)?.name ?? 'Lobby';
}

export function TasksPage({
  tasks,
  floors,
  proposals,
  employees = [],
  selectedId,
  configured,
  onSelect,
  onNew,
  onSend,
  onCancel,
  onDecide,
  onCorrect,
  onSetVisibility,
  onRequestHandoff,
}: {
  tasks: Task[];
  floors: Floor[];
  proposals: ActionProposal[];
  /** Workspace employees, used to offer a handoff to someone else on the task's floor. */
  employees?: Employee[];
  selectedId: string | null;
  configured: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSend: (taskId: string, text: string) => void;
  onCancel: (taskId: string) => void;
  onDecide: (id: string, approved: boolean) => void;
  onCorrect: (id: string) => void;
  onSetVisibility?: (taskId: string, visibility: TaskVisibility) => void;
  onRequestHandoff?: (floorId: string, toEmployeeId: string, brief: string, taskId: string) => void;
}) {
  const [floorFilter, setFloorFilter] = useState('all');
  const { open, openDetail, closeDetail } = useMasterDetail();
  const shownTasks = tasks.filter((task) =>
    floorFilter === 'all' ? true : floorFilter === 'lobby' ? !task.floorId : task.floorId === floorFilter,
  );
  const selected = shownTasks.find((task) => task.id === selectedId) ?? shownTasks[0];
  const floor = floors.find((floor) => floor.id === selected?.floorId);
  const floorEmployees = employees.filter((employee) => floor?.employeeIds.includes(employee.id));
  return (
    <div>
      <PageIntro
        title="Tasks"
        description="Every task, its conversation, and the external changes waiting for review."
        action={
          <button className="primary-button" onClick={onNew} disabled={!configured}>
            <Plus size={17} />
            New task
          </button>
        }
      />
      {tasks.length ? (
        <MasterDetail
          className="task-layout card"
          open={open}
          backLabel="Tasks"
          onBack={closeDetail}
          list={
            <div className="task-list">
              <div className="pane-toolbar">
                <strong>{pluralize(shownTasks.length, 'task')}</strong>
                <label className="task-floor-filter">
                  <span className="sr-only">Filter by floor</span>
                  <select value={floorFilter} onChange={(event) => setFloorFilter(event.target.value)}>
                    <option value="all">All floors</option>
                    <option value="lobby">Lobby</option>
                    {floors.map((floor) => (
                      <option key={floor.id} value={floor.id}>
                        {floor.name}
                        {floor.archivedAt ? ' · Archived' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {shownTasks.map((task) => (
                <button
                  key={task.id}
                  data-active={selected?.id === task.id}
                  onClick={() => {
                    onSelect(task.id);
                    openDetail();
                  }}
                >
                  <StatusMark status={task.status} />
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.employeeName} · {relativeTime(task.updatedAt)}
                    </small>
                    {task.visibility === 'workspace' && (
                      <small className="task-shared">
                        {task.isOwner ? 'Shared with the workspace' : `Shared by ${task.createdByName}`}
                      </small>
                    )}
                    <span className="task-floor-label">{taskFloorName(task, floors)}</span>
                  </span>
                </button>
              ))}
              {!shownTasks.length && (
                <EmptyPane
                  icon={<ListTodo size={22} />}
                  title="No tasks on this floor"
                  text="Choose another floor or create a task."
                />
              )}
            </div>
          }
          detail={
            selected && (
              <TaskDetail
                key={selected.id}
                task={selected}
                floorName={taskFloorName(selected, floors)}
                proposals={proposals.filter((proposal) => proposal.taskId === selected.id)}
                floorEmployees={floorEmployees}
                onSend={onSend}
                onCancel={onCancel}
                onDecide={onDecide}
                onCorrect={onCorrect}
                onSetVisibility={onSetVisibility}
                onRequestHandoff={onRequestHandoff}
              />
            )
          }
        />
      ) : (
        <EmptySection
          icon={<ListTodo size={28} />}
          title="No assignments yet"
          text="Choose an employee, describe the outcome you need, and follow their work here."
          action={
            <button className="primary-button" disabled={!configured} onClick={onNew}>
              <Plus size={16} />
              Create first task
            </button>
          }
        />
      )}
    </div>
  );
}
