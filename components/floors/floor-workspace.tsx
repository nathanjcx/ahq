'use client';

import { ArrowRight, ChevronRight, Clock3, Pencil, Plus, UserPlus, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Employee, Project, Task } from '@/lib/contracts';
import type { OfficeEmployee } from '../office/office-view';
import { EmptyMini } from '../shared/empty';
import { relativeTime, statusLabel } from '../shared/format';
import { Avatar, StatusMark } from '../shared/marks';

const OfficeView = dynamic(() => import('../office/office-view'), { ssr: false });

export function FloorWorkspace({
  project,
  floorLabel,
  configured,
  floorEmployees,
  officeEmployees,
  activeTasks,
  hasEmployees,
  onEditProject,
  onNewTask,
  onEmployee,
  onTask,
  onAllTasks,
}: {
  project: Project | null;
  floorLabel: string;
  configured: boolean;
  floorEmployees: Employee[];
  officeEmployees: OfficeEmployee[];
  activeTasks: Task[];
  hasEmployees: boolean;
  onEditProject: (project: Project) => void;
  onNewTask: (projectId: string | null) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onAllTasks: () => void;
}) {
  const isArchived = Boolean(project?.archivedAt);
  return (
    <section className="floor-workspace card" aria-live="polite">
      <header className="floor-heading">
        <div>
          <span className="eyebrow">{isArchived ? 'ARCHIVED FLOOR' : floorLabel.toUpperCase()}</span>
          <h2>{project?.name || 'Lobby'}</h2>
          <p>{project?.brief || 'Tasks created without a project stay here.'}</p>
        </div>
        <div className="floor-heading-actions">
          {project && (
            <button className="secondary-button compact" onClick={() => onEditProject(project)}>
              <Pencil size={14} /> {isArchived ? 'Manage' : 'Edit floor'}
            </button>
          )}
          {!isArchived && (
            <button
              className="primary-button compact"
              disabled={!officeEmployees.length}
              onClick={() => onNewTask(project?.id ?? null)}
            >
              <Plus size={15} /> Assign work
            </button>
          )}
        </div>
      </header>

      <div className="floor-overview">
        <div className="office-canvas floor-canvas">
          <div className="office-toolbar">
            <span>
              <span className="live-dot" /> {isArchived ? 'ARCHIVED OFFICE' : 'LIVE OFFICE'}
            </span>
            <span>
              {floorEmployees.length} {floorEmployees.length === 1 ? 'employee' : 'employees'}
            </span>
          </div>
          <div className="office-stage floor-stage">
            <OfficeView
              employees={officeEmployees}
              onSelect={onEmployee}
              label={project ? `${floorLabel} · ${project.name}` : 'Lobby'}
              emptyMessage={
                floorEmployees.length
                  ? 'This team needs its connections set up. Select an employee to review access.'
                  : project
                    ? 'This floor is ready. Edit the floor to add its project team.'
                    : hasEmployees
                      ? 'The lobby is clear. Employees staffed on project floors appear there.'
                      : 'Your office is ready. Hire your first employee to get started.'
              }
            />
          </div>
          <div className="office-legend">
            <span>
              <i className="status-dot working" /> Working
            </span>
            <span>
              <i className="status-dot waiting" /> Needs review
            </span>
            <span>
              <i className="status-dot idle" /> Available
            </span>
          </div>
        </div>

        <aside className="floor-team">
          <div className="section-title">
            <div>
              <span className="eyebrow">STAFFING</span>
              <h3>{project ? 'Project team' : 'Unassigned team'}</h3>
            </div>
            <span className="staff-count">{floorEmployees.length}</span>
          </div>
          {floorEmployees.length ? (
            <div className="floor-team-list">
              {floorEmployees.map((employee) => (
                <button key={employee.id} onClick={() => onEmployee(employee.id)}>
                  <Avatar employee={employee} />
                  <span>
                    <strong>{employee.name}</strong>
                    <small>{employee.role}</small>
                  </span>
                  <span
                    className={`availability ${employee.status.toLowerCase().includes('work') ? 'busy' : ''}`}
                  >
                    {employee.status}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyMini
              icon={<Users size={19} />}
              title={project ? 'No one staffed yet' : 'No one waiting in the lobby'}
              text={
                project
                  ? 'Edit this floor to add one or more employees.'
                  : 'Employees without an active project appear here.'
              }
            />
          )}
          {project && !isArchived && (
            <button className="floor-team-edit" onClick={() => onEditProject(project)}>
              <UserPlus size={14} /> Manage staffing
            </button>
          )}
        </aside>
      </div>

      <div className="floor-queue">
        <div className="section-title">
          <div>
            <span className="eyebrow">YOUR WORK QUEUE</span>
            <h3>
              {activeTasks.length
                ? `${activeTasks.length} active ${activeTasks.length === 1 ? 'task' : 'tasks'}`
                : 'Nothing in motion'}
            </h3>
          </div>
          <button className="text-button" onClick={onAllTasks}>
            All tasks <ArrowRight size={14} />
          </button>
        </div>
        {activeTasks.length ? (
          <div className="floor-task-list">
            {activeTasks.slice(0, 5).map((task) => (
              <button key={task.id} onClick={() => onTask(task.id)}>
                <StatusMark status={task.status} />
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.employeeName}</small>
                </span>
                <span className="queue-meta">
                  {statusLabel(task.status)}
                  <small>{relativeTime(task.updatedAt)}</small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        ) : (
          <div className="floor-queue-empty">
            <Clock3 size={18} />
            <p>
              {configured
                ? project
                  ? 'Your assignments for this project will collect here.'
                  : 'Your unassigned tasks and older work will collect here.'
                : 'Connect the backend to see live work.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
