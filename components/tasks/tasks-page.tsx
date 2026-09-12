'use client';

import { ListTodo, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ActionProposal, Employee, Project, Task, TaskVisibility } from '@/lib/contracts';
import { EmptyPane, EmptySection } from '../shared/empty';
import { relativeTime } from '../shared/format';
import { StatusMark } from '../shared/marks';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { TaskDetail } from './task-detail';
import './tasks.css';

export function taskFloorName(task: Task, projects: Project[]) {
  return (
    task.projectContext?.name ?? projects.find((project) => project.id === task.projectId)?.name ?? 'Lobby'
  );
}

export function TasksPage({
  tasks,
  projects,
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
  projects: Project[];
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
  onRequestHandoff?: (projectId: string, toEmployeeId: string, brief: string, taskId: string) => void;
}) {
  const [projectFilter, setProjectFilter] = useState('all');
  const { open, openDetail, closeDetail } = useMasterDetail();
  const shownTasks = tasks.filter((task) =>
    projectFilter === 'all'
      ? true
      : projectFilter === 'lobby'
        ? !task.projectId
        : task.projectId === projectFilter,
  );
  const selected = shownTasks.find((task) => task.id === selectedId) ?? shownTasks[0];
  const floor = projects.find((project) => project.id === selected?.projectId);
  const floorEmployees = employees.filter((employee) => floor?.employeeIds.includes(employee.id));
  return (
    <div>
      <PageIntro
        eyebrow="ASSIGNMENTS"
        title="Tasks"
        description="Follow work as it happens. Review external changes before they run."
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
                <strong>
                  {shownTasks.length} {shownTasks.length === 1 ? 'task' : 'tasks'}
                </strong>
                <label className="task-floor-filter">
                  <span className="sr-only">Filter by project floor</span>
                  <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                    <option value="all">All floors</option>
                    <option value="lobby">Lobby</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                        {project.archivedAt ? ' · Archived' : ''}
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
                    <span className="task-floor-label">{taskFloorName(task, projects)}</span>
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
                floorName={taskFloorName(selected, projects)}
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
