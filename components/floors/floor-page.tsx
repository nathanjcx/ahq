'use client';

import { Plus } from 'lucide-react';
import type { Dashboard, Employee, Project } from '@/lib/contracts';
import type { Page } from '../app/nav';
import { PageIntro } from '../shared/page-intro';
import { timeGreeting } from '../shared/format';
import { FloorDirectory } from './floor-directory';
import { FloorWorkspace } from './floor-workspace';

const ACTIVE_TASK_STATUSES = ['queued', 'running', 'awaiting_approval'];

export function FloorPage({
  dashboard,
  configured,
  onPage,
  onEmployee,
  onTask,
  selectedProjectId,
  onSelectProject,
  onNewProject,
  onEditProject,
  onNewTask,
}: {
  dashboard: Dashboard;
  configured: boolean;
  onPage: (page: Page) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onNewTask: (projectId: string | null) => void;
}) {
  const orderedProjects = [...dashboard.projects].sort((a, b) => a.createdAt - b.createdAt);
  const activeProjects = orderedProjects.filter((project) => !project.archivedAt);
  const selectedProject = dashboard.projects.find((project) => project.id === selectedProjectId) ?? null;
  const assignedEmployeeIds = new Set(activeProjects.flatMap((project) => project.employeeIds));
  const lobbyEmployeeIds = new Set(
    dashboard.tasks
      .filter((task) => !task.projectId && ACTIVE_TASK_STATUSES.includes(task.status))
      .map((task) => task.employeeId),
  );
  const floorEmployees = selectedProject
    ? selectedProject.employeeIds
        .map((id) => dashboard.employees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => Boolean(employee))
    : dashboard.employees.filter(
        (employee) => !assignedEmployeeIds.has(employee.id) || lobbyEmployeeIds.has(employee.id),
      );
  const floorTasks = dashboard.tasks.filter((task) =>
    selectedProject ? task.projectId === selectedProject.id : !task.projectId,
  );
  const activeTasks = floorTasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  const officeEmployees = floorEmployees
    .filter((employee) => employee.status === 'ready')
    .map((employee) => {
      const work = activeTasks.filter((task) => task.employeeId === employee.id);
      return {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        color: employee.color,
        status: work.some((task) => task.status === 'awaiting_approval')
          ? 'review'
          : work.some((task) => task.status === 'running')
            ? 'working'
            : 'ready',
      };
    });
  const floorIndex = orderedProjects.findIndex((project) => project.id === selectedProject?.id);
  const floorLabel = selectedProject && floorIndex >= 0 ? `Floor ${floorIndex + 1}` : 'Lobby';

  return (
    <div className="office-page">
      <PageIntro
        eyebrow="PROJECT FLOORS"
        title={
          dashboard.workspace
            ? `Good ${timeGreeting()}, ${dashboard.workspace.name}`
            : 'Your team starts here'
        }
        description={
          dashboard.workspace
            ? 'Move between project floors, see who is staffed, and keep unassigned work in the lobby.'
            : 'Connect your workspace, hire your first employee, and give them a clear assignment.'
        }
        action={
          <button
            className="primary-button"
            disabled={!configured || !dashboard.workspace}
            onClick={onNewProject}
          >
            <Plus size={17} /> New project floor
          </button>
        }
      />
      <div className="building-layout">
        <FloorDirectory
          workspaceName={dashboard.workspace?.name}
          orderedProjects={orderedProjects}
          selectedProjectId={selectedProject?.id ?? null}
          unassignedTaskCount={dashboard.tasks.filter((task) => !task.projectId).length}
          canCreate={configured && Boolean(dashboard.workspace)}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
        />
        <FloorWorkspace
          project={selectedProject}
          floorLabel={floorLabel}
          configured={configured}
          floorEmployees={floorEmployees}
          officeEmployees={officeEmployees}
          activeTasks={activeTasks}
          hasEmployees={dashboard.employees.length > 0}
          onEditProject={onEditProject}
          onNewTask={onNewTask}
          onEmployee={onEmployee}
          onTask={onTask}
          onAllTasks={() => onPage('tasks')}
        />
      </div>
      <div className="office-summary" aria-label="Workspace summary">
        <button onClick={() => onPage('inbox')}>
          <span>Inbox</span>
          <strong>{dashboard.inbox.filter((item) => item.status === 'unread').length}</strong>
          <small>unread items</small>
        </button>
        <button onClick={() => onPage('tasks')}>
          <span>Reviews</span>
          <strong>{dashboard.proposals.filter((proposal) => proposal.status === 'pending').length}</strong>
          <small>need you</small>
        </button>
        <button onClick={() => onPage('activity')}>
          <span>Your active work</span>
          <strong>
            {dashboard.tasks.filter((task) => ['queued', 'running'].includes(task.status)).length}
          </strong>
          <small>across all floors</small>
        </button>
      </div>
    </div>
  );
}
