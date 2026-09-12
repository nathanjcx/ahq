'use client';

import { ArrowRight, ChevronRight, Clock3, Plus, Users } from 'lucide-react';
import type { Employee, Task } from '@/lib/contracts';
import type { OfficeEmployee } from '../office/office-view';
import { EmptyMini } from '../shared/empty';
import { relativeTime, statusLabel } from '../shared/format';
import { Avatar, StatusMark } from '../shared/marks';
import { FloorScene } from './floor-scene';

/** The ground floor: the office scene plus whoever and whatever is not on a project floor. */
export function LobbyView({
  configured,
  lobbyEmployees,
  officeEmployees,
  activeTasks,
  hasEmployees,
  onNewTask,
  onEmployee,
  onTask,
  onAllTasks,
}: {
  configured: boolean;
  lobbyEmployees: Employee[];
  officeEmployees: OfficeEmployee[];
  activeTasks: Task[];
  hasEmployees: boolean;
  onNewTask: () => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onAllTasks: () => void;
}) {
  return (
    <section className="floor-workspace card" aria-live="polite">
      <header className="floor-heading">
        <div>
          <span className="eyebrow">LOBBY</span>
          <h2>Lobby</h2>
          <p>Tasks created without a project stay here.</p>
        </div>
        <div className="floor-heading-actions">
          <button
            className="primary-button compact"
            disabled={!configured || !officeEmployees.length}
            onClick={onNewTask}
          >
            <Plus size={15} /> Assign work
          </button>
        </div>
      </header>

      <div className="floor-overview">
        <FloorScene
          label="Lobby"
          live={configured}
          employeeCount={lobbyEmployees.length}
          officeEmployees={officeEmployees}
          emptyMessage={
            lobbyEmployees.length
              ? 'This team needs its connections set up. Select an employee to review access.'
              : hasEmployees
                ? 'The lobby is clear. Employees staffed on project floors appear there.'
                : 'Your office is ready. Hire your first employee to get started.'
          }
          onEmployee={onEmployee}
        />

        <aside className="floor-team">
          <div className="section-title">
            <div>
              <span className="eyebrow">STAFFING</span>
              <h3>Unassigned team</h3>
            </div>
            <span className="staff-count">{lobbyEmployees.length}</span>
          </div>
          {lobbyEmployees.length ? (
            <div className="floor-team-list">
              {lobbyEmployees.map((employee) => (
                <button key={employee.id} className="team-open" onClick={() => onEmployee(employee.id)}>
                  <Avatar employee={employee} />
                  <span>
                    <strong>{employee.name}</strong>
                    <small>{employee.role}</small>
                  </span>
                  <span className={`availability ${employee.status === 'ready' ? '' : 'busy'}`}>
                    {employee.status}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyMini
              icon={<Users size={19} />}
              title="No one waiting in the lobby"
              text="Employees without an active project appear here."
            />
          )}
        </aside>
      </div>

      <div className="floor-queue">
        <div className="section-title">
          <div>
            <span className="eyebrow">UNASSIGNED WORK</span>
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
            {activeTasks.slice(0, 6).map((task) => (
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
                ? 'Your unassigned tasks and older work will collect here.'
                : 'Connect the backend to see live work.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
