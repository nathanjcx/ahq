'use client';

import type { Actions } from '../app/actions';
import type { Destination } from '../app/nav';
import { FloorFeeds } from '../channels/floor-feeds';
import { FloorBinder } from './floor-binder';
import { FloorChannel } from './floor-channel';
import { ACTIVE_TASK_STATUSES, summarizeFloor, type FloorEntry } from './floor-stats';
import { FloorTeamList } from './floor-team';
import { FloorWork } from './floor-work';
import { Office2D } from './office-2d';
import { Office3D, type PanelTab } from './office-3d';
import { toOfficeEmployees } from './office-employees';
import { WeekList } from './week-list';
import type { Dashboard, Employee, Floor, Task } from '@/lib/contracts';
import './floors.css';

export type OfficeMode = '3d' | '2d';

/**
 * The Office destination: the building, one level at a time. The 3D view is the room itself with
 * every control inside the viewport; the 2D view is the same level laid out as a board.
 */
export function FloorPage({
  mode,
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
  mode: OfficeMode;
  dashboard: Dashboard;
  configured: boolean;
  actions: Actions;
  run: (work: () => Promise<unknown>, success: string) => Promise<boolean>;
  onPage: (page: Destination) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  selectedFloorId: string | null;
  onSelectFloor: (id: string | null) => void;
  onNewFloor: () => void;
  onEditFloor: (floor: Floor) => void;
  onNewTask: (floorId: string | null, employeeId?: string | null) => void;
}) {
  const all: FloorEntry[] = [...dashboard.floors]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((floor, index) => ({
      floor,
      number: String(index + 1).padStart(2, '0'),
      summary: summarizeFloor(floor, dashboard.tasks),
    }));
  const entries = {
    active: all
      .filter((entry) => !entry.floor.archivedAt)
      .sort((a, b) => b.summary.lastActivity - a.summary.lastActivity),
    archived: all.filter((entry) => entry.floor.archivedAt),
  };
  const selected = all.find((entry) => entry.floor.id === selectedFloorId) ?? null;
  const floor = selected?.floor ?? null;
  const workspaceReady = configured && Boolean(dashboard.workspace);
  const canAct = workspaceReady && !floor?.archivedAt;

  // The level's people and work: a floor's staff and tasks, or whoever and whatever has no floor.
  const tasks = dashboard.tasks.filter((task) => (floor ? task.floorId === floor.id : !task.floorId));
  const activeTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  const staff = floor
    ? floor.employeeIds
        .map((id) => dashboard.employees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => Boolean(employee))
    : (() => {
        const staffedElsewhere = new Set(entries.active.flatMap((entry) => entry.floor.employeeIds));
        const busyHere = new Set(activeTasks.map((task) => task.employeeId));
        return dashboard.employees.filter(
          (employee) => !staffedElsewhere.has(employee.id) || busyHere.has(employee.id),
        );
      })();
  const unassignedTaskCount = dashboard.tasks.filter((task) => !task.floorId).length;

  const board = floor && (
    <FloorChannel
      floorId={floor.id}
      staff={staff}
      canPost={canAct}
      actions={actions}
      run={run}
      onTask={onTask}
    />
  );
  const feeds = floor && <FloorFeeds staff={staff} onTask={onTask} />;
  const binder = floor && (
    <FloorBinder
      floorId={floor.id}
      canApprove={canAct}
      onApprove={(id) => void run(() => actions.approveMemory(id), 'Claim approved')}
      onRecords={() => onPage('records')}
    />
  );
  const shared = {
    entries,
    selected,
    dashboard,
    configured: workspaceReady,
    staff,
    tasks,
    unassignedTaskCount,
    onSelectFloor,
    onNewFloor,
    onEditFloor: () => floor && onEditFloor(floor),
    onArchive: (archived: boolean) =>
      floor &&
      void run(
        () => actions.setFloorArchived(floor.id, archived),
        archived ? 'Floor archived' : 'Floor restored',
      ),
    onEmployee,
  };

  if (mode === '2d')
    return (
      <Office2D
        {...shared}
        proposals={dashboard.proposals}
        board={board || undefined}
        feeds={feeds || undefined}
        binder={binder || undefined}
        onNewTask={(employeeId) => onNewTask(floor?.id ?? null, employeeId ?? null)}
        onTask={onTask}
        onCalendar={() => onPage('calendar')}
        onAllTasks={() => onPage('tasks')}
      />
    );

  const panels: PanelTab[] = [
    {
      id: 'team',
      label: 'Team',
      content: (
        <FloorTeamList
          staff={staff}
          tasks={tasks}
          schedule={dashboard.schedule}
          canAssign={canAct}
          emptyTitle={floor ? 'No one staffed yet' : 'Everyone is on a floor'}
          emptyText={
            floor ? 'Edit this floor to add one or more employees.' : 'Employees without a floor appear here.'
          }
          onEmployee={onEmployee}
          onNewTask={(employeeId) => onNewTask(floor?.id ?? null, employeeId)}
        />
      ),
    },
    {
      id: 'work',
      label: 'Work',
      content: (
        <FloorWork
          tasks={tasks}
          proposals={dashboard.proposals}
          canAssign={canAct && staff.length > 0}
          onTask={onTask}
          onNewTask={() => onNewTask(floor?.id ?? null)}
        />
      ),
    },
    ...(floor
      ? [
          { id: 'board', label: 'Board', content: board },
          { id: 'feeds', label: 'Feeds', content: feeds },
          { id: 'binder', label: 'Binder', content: binder },
        ]
      : []),
    {
      id: 'week',
      label: 'Week',
      content: <WeekList live={workspaceReady} onCalendar={() => onPage('calendar')} />,
    },
  ];

  return (
    <Office3D
      {...shared}
      officeEmployees={toOfficeEmployees(staff, activeTasks)}
      panels={panels}
      onNewTask={() => onNewTask(floor?.id ?? null)}
    />
  );
}
