'use client';

import { Plus } from 'lucide-react';
import type { Actions } from '../app/actions';
import type { Page } from '../app/nav';
import { FloorFeeds } from '../channels/floor-feeds';
import type { OfficeEmployee } from '../office/office-view';
import { PageIntro } from '../shared/page-intro';
import { FloorBinder } from './floor-binder';
import { FloorChannel } from './floor-channel';
import { FloorDirectory } from './floor-directory';
import { ACTIVE_TASK_STATUSES, summarizeFloor, type FloorEntry } from './floor-stats';
import { FloorView } from './floor-view';
import { LobbyView } from './lobby-view';
import type { Dashboard, Employee, Floor, Task } from '@/lib/contracts';
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
  selectedFloorId,
  onSelectFloor,
  onNewFloor,
  onEditFloor,
  onNewTask,
}: {
  dashboard: Dashboard;
  configured: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onPage: (page: Page) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  selectedFloorId: string | null;
  onSelectFloor: (id: string | null) => void;
  onNewFloor: () => void;
  onEditFloor: (floor: Floor) => void;
  onNewTask: (floorId: string | null, employeeId?: string | null) => void;
}) {
  const entries: FloorEntry[] = [...dashboard.floors]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((floor, index) => ({
      floor,
      number: String(index + 1).padStart(2, '0'),
      summary: summarizeFloor(floor, dashboard.tasks),
    }));
  const activeFloors = entries
    .filter((entry) => !entry.floor.archivedAt)
    .sort((a, b) => b.summary.lastActivity - a.summary.lastActivity);
  const archivedFloors = entries.filter((entry) => entry.floor.archivedAt);
  const selected = entries.find((entry) => entry.floor.id === selectedFloorId) ?? null;

  const workspaceReady = configured && Boolean(dashboard.workspace);

  return (
    <div className="office-page">
      <PageIntro
        eyebrow="FLOORS"
        title={dashboard.workspace ? 'Office' : 'Set up your workspace'}
        description={
          dashboard.workspace
            ? 'Floors, who is staffed on them, and work that has no floor yet.'
            : 'Create a workspace, hire an employee, and give them a task.'
        }
        action={
          <button className="primary-button" disabled={!workspaceReady} onClick={onNewFloor}>
            <Plus size={17} /> New floor
          </button>
        }
      />
      <div className="building-layout">
        <FloorDirectory
          workspaceName={dashboard.workspace?.name}
          activeFloors={activeFloors}
          archivedFloors={archivedFloors}
          selectedFloorId={selected?.floor.id ?? null}
          unassignedTaskCount={dashboard.tasks.filter((task) => !task.floorId).length}
          canCreate={workspaceReady}
          onSelectFloor={onSelectFloor}
          onNewFloor={onNewFloor}
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
            onEditFloor={onEditFloor}
            onRecords={() => onPage('records')}
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
  onEditFloor,
  onRecords,
}: {
  entry: FloorEntry;
  floorLabel: string;
  dashboard: Dashboard;
  configured: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onNewTask: (floorId: string | null, employeeId?: string | null) => void;
  onEditFloor: (floor: Floor) => void;
  /** The Records room, where the binder's provenance and supersession chains live. */
  onRecords: () => void;
}) {
  const { floor, summary } = entry;
  const staff = floor.employeeIds
    .map((id) => dashboard.employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => Boolean(employee));
  const tasks = dashboard.tasks.filter((task) => task.floorId === floor.id);
  const activeTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  return (
    <FloorView
      key={floor.id}
      floor={floor}
      dashboard={dashboard}
      floorLabel={floorLabel}
      summary={summary}
      staff={staff}
      officeEmployees={toOfficeEmployees(staff, activeTasks)}
      tasks={tasks}
      proposals={dashboard.proposals}
      schedule={dashboard.schedule}
      board={
        <FloorChannel
          floorId={floor.id}
          staff={staff}
          canPost={configured && !floor.archivedAt}
          actions={actions}
          run={run}
          onTask={onTask}
        />
      }
      feeds={<FloorFeeds staff={staff} onTask={onTask} />}
      binder={
        <FloorBinder
          floorId={floor.id}
          canApprove={configured && !floor.archivedAt}
          onApprove={(id) => void run(() => actions.approveMemory(id), 'Claim approved')}
          onRecords={onRecords}
        />
      }
      configured={configured}
      onEmployee={onEmployee}
      onTask={onTask}
      onNewTask={(employeeId) => onNewTask(floor.id, employeeId ?? null)}
      onEditFloor={() => onEditFloor(floor)}
      onArchive={(archived) =>
        void run(
          () => actions.setFloorArchived(floor.id, archived),
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
  onNewTask: (floorId: string | null) => void;
  onAllTasks: () => void;
}) {
  const lobbyTasks = dashboard.tasks.filter((task) => !task.floorId);
  const activeTasks = lobbyTasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  const staffedElsewhere = new Set(activeFloors.flatMap((entry) => entry.floor.employeeIds));
  const busyInLobby = new Set(activeTasks.map((task) => task.employeeId));
  const lobbyEmployees = dashboard.employees.filter(
    (employee) => !staffedElsewhere.has(employee.id) || busyInLobby.has(employee.id),
  );

  return (
    <LobbyView
      dashboard={dashboard}
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
