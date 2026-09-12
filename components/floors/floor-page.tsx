'use client';

import { Plus } from 'lucide-react';
import type { Dashboard, Employee, Project, Task } from '@/lib/contracts';
import type { Actions } from '../app/actions';
import type { Page } from '../app/nav';
import type { OfficeEmployee } from '../office/office-view';
import { PageIntro } from '../shared/page-intro';
import { timeGreeting } from '../shared/format';
import { FloorBoard, LiveFloorBoard } from './floor-board';
import { FloorDirectory } from './floor-directory';
import { FloorView } from './floor-view';
import { LobbyView } from './lobby-view';
import { ACTIVE_TASK_STATUSES, summarizeFloor, type FloorEntry } from './floor-stats';
import './floors.css';

/** Maps a floor's employees to the 3D office, using their live work for presence. */
function toOfficeEmployees(employees: Employee[], activeTasks: Task[]): OfficeEmployee[] {
  return employees
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
}

export function FloorPage({
  dashboard,
  configured,
  actions,
  run,
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
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onPage: (page: Page) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
  onEditProject: (project: Project) => void;
  onNewTask: (projectId: string | null, employeeId?: string | null) => void;
}) {
  const entries: FloorEntry[] = [...dashboard.projects]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((project, index) => ({
      project,
      number: String(index + 1).padStart(2, '0'),
      summary: summarizeFloor(project, dashboard.tasks),
    }));
  const activeFloors = entries
    .filter((entry) => !entry.project.archivedAt)
    .sort((a, b) => b.summary.lastActivity - a.summary.lastActivity);
  const archivedFloors = entries.filter((entry) => entry.project.archivedAt);
  const selected = entries.find((entry) => entry.project.id === selectedProjectId) ?? null;

  const workspaceReady = configured && Boolean(dashboard.workspace);
  const decideHandoff = async (postId: string, accepted: boolean) => {
    let taskId: string | undefined;
    const decided = await run(
      async () => {
        taskId = (await actions.decideHandoff(postId, accepted))?.taskId;
      },
      accepted ? 'Handoff accepted' : 'Handoff declined',
    );
    if (decided && taskId) onTask(taskId);
  };

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
          <button className="primary-button" disabled={!workspaceReady} onClick={onNewProject}>
            <Plus size={17} /> New project floor
          </button>
        }
      />
      <div className="building-layout">
        <FloorDirectory
          workspaceName={dashboard.workspace?.name}
          activeFloors={activeFloors}
          archivedFloors={archivedFloors}
          selectedProjectId={selected?.project.id ?? null}
          unassignedTaskCount={dashboard.tasks.filter((task) => !task.projectId).length}
          canCreate={workspaceReady}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
        />
        {selected ? (
          <SelectedFloor
            entry={selected}
            floorLabel={`Floor ${Number(selected.number)}`}
            dashboard={dashboard}
            configured={configured}
            actions={actions}
            run={run}
            onEmployee={onEmployee}
            onTask={onTask}
            onNewTask={onNewTask}
            onEditProject={onEditProject}
            onDecideHandoff={decideHandoff}
          />
        ) : (
          <Lobby
            dashboard={dashboard}
            configured={configured}
            activeFloors={activeFloors}
            onEmployee={onEmployee}
            onTask={onTask}
            onNewTask={onNewTask}
            onAllTasks={() => onPage('tasks')}
          />
        )}
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

function SelectedFloor({
  entry,
  floorLabel,
  dashboard,
  configured,
  actions,
  run,
  onEmployee,
  onTask,
  onNewTask,
  onEditProject,
  onDecideHandoff,
}: {
  entry: FloorEntry;
  floorLabel: string;
  dashboard: Dashboard;
  configured: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onNewTask: (projectId: string | null, employeeId?: string | null) => void;
  onEditProject: (project: Project) => void;
  onDecideHandoff: (postId: string, accepted: boolean) => void;
}) {
  const { project, summary } = entry;
  const staff = project.employeeIds
    .map((id) => dashboard.employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => Boolean(employee));
  const tasks = dashboard.tasks.filter((task) => task.projectId === project.id);
  const activeTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  const boardProps = {
    staff,
    canPost: configured && !project.archivedAt,
    onTask,
    onPost: (text: string) => void run(() => actions.postToBoard(project.id, text), 'Posted to the board'),
    onRequestHandoff: (toEmployeeId: string, brief: string) =>
      void run(() => actions.requestHandoff(project.id, toEmployeeId, brief), 'Handoff requested'),
    onDecideHandoff,
  };

  return (
    <FloorView
      key={project.id}
      project={project}
      floorLabel={floorLabel}
      summary={summary}
      staff={staff}
      officeEmployees={toOfficeEmployees(staff, activeTasks)}
      tasks={tasks}
      proposals={dashboard.proposals}
      board={
        configured ? (
          <LiveFloorBoard projectId={project.id} {...boardProps} />
        ) : (
          <FloorBoard posts={[]} {...boardProps} />
        )
      }
      configured={configured}
      onEmployee={onEmployee}
      onTask={onTask}
      onNewTask={(employeeId) => onNewTask(project.id, employeeId ?? null)}
      onEditProject={() => onEditProject(project)}
      onArchive={(archived) =>
        void run(
          () => actions.setProjectArchived(project.id, archived),
          archived ? 'Floor archived' : 'Floor restored',
        )
      }
    />
  );
}

function Lobby({
  dashboard,
  configured,
  activeFloors,
  onEmployee,
  onTask,
  onNewTask,
  onAllTasks,
}: {
  dashboard: Dashboard;
  configured: boolean;
  activeFloors: FloorEntry[];
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onNewTask: (projectId: string | null) => void;
  onAllTasks: () => void;
}) {
  const lobbyTasks = dashboard.tasks.filter((task) => !task.projectId);
  const activeTasks = lobbyTasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  const staffedElsewhere = new Set(activeFloors.flatMap((entry) => entry.project.employeeIds));
  const busyInLobby = new Set(activeTasks.map((task) => task.employeeId));
  const lobbyEmployees = dashboard.employees.filter(
    (employee) => !staffedElsewhere.has(employee.id) || busyInLobby.has(employee.id),
  );

  return (
    <LobbyView
      configured={configured}
      lobbyEmployees={lobbyEmployees}
      officeEmployees={toOfficeEmployees(lobbyEmployees, activeTasks)}
      activeTasks={activeTasks}
      hasEmployees={dashboard.employees.length > 0}
      onNewTask={() => onNewTask(null)}
      onEmployee={onEmployee}
      onTask={onTask}
      onAllTasks={onAllTasks}
    />
  );
}
