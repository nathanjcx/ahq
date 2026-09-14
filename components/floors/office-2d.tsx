'use client';

import { Archive, ArrowRight, Pencil, Plus, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '../shared/marks';
import { relativeTime } from '../shared/time';
import { FloorDirectory } from './floor-directory';
import type { FloorEntry, FloorSummary } from './floor-stats';
import { FloorTeamList } from './floor-team';
import { FloorWork } from './floor-work';
import { WeekList } from './week-list';
import type { ActionProposal, Dashboard, Employee, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

/**
 * The office as a board: the building directory on the left and the chosen floor laid out whole on
 * the right, so nothing hides behind a region switch. Team and the week in the first column, the
 * floor's work in the second, its channel in the third; the instance feeds and the memory binder
 * follow underneath. The page scrolls like a document.
 */
export function Office2D({
  entries,
  selected,
  dashboard,
  configured,
  staff,
  tasks,
  proposals,
  unassignedTaskCount,
  board,
  feeds,
  binder,
  onSelectFloor,
  onNewFloor,
  onEditFloor,
  onArchive,
  onNewTask,
  onEmployee,
  onTask,
  onCalendar,
  onAllTasks,
}: {
  entries: { active: FloorEntry[]; archived: FloorEntry[] };
  selected: FloorEntry | null;
  dashboard: Dashboard;
  configured: boolean;
  staff: Employee[];
  tasks: Task[];
  proposals: ActionProposal[];
  unassignedTaskCount: number;
  /** The floor's channel, feeds, and binder; absent in the lobby, which has none. */
  board?: ReactNode;
  feeds?: ReactNode;
  binder?: ReactNode;
  onSelectFloor: (id: string | null) => void;
  onNewFloor: () => void;
  onEditFloor: () => void;
  onArchive: (archived: boolean) => void;
  onNewTask: (employeeId?: string) => void;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onCalendar: () => void;
  onAllTasks: () => void;
}) {
  const floor = selected?.floor ?? null;
  const archived = Boolean(floor?.archivedAt);
  const canAct = configured && !archived;
  return (
    <div className="office-2d">
      <FloorDirectory
        workspaceName={dashboard.workspace?.name}
        activeFloors={entries.active}
        archivedFloors={entries.archived}
        selectedFloorId={floor?.id ?? null}
        unassignedTaskCount={unassignedTaskCount}
        canCreate={configured}
        onSelectFloor={onSelectFloor}
        onNewFloor={onNewFloor}
      />
      <section className="office-2d-floor card" key={floor?.id ?? 'lobby'}>
        <FloorHeader
          entry={selected}
          staff={staff}
          configured={configured}
          onEditFloor={onEditFloor}
          onArchive={onArchive}
          onNewTask={() => onNewTask()}
        />
        <div className="office-2d-grid" data-cols={board ? 3 : 2}>
          <section className="office-2d-cell" aria-label={floor ? 'Floor team' : 'Unassigned team'}>
            <div className="section-title">
              <h3>{floor ? 'Team' : 'Unassigned team'}</h3>
              <span className="staff-count">{staff.length}</span>
            </div>
            <FloorTeamList
              staff={staff}
              tasks={tasks}
              schedule={dashboard.schedule}
              canAssign={canAct}
              emptyTitle={floor ? 'No one staffed yet' : 'Everyone is on a floor'}
              emptyText={
                floor
                  ? 'Edit this floor to add one or more employees.'
                  : 'Employees without a floor appear here.'
              }
              onEmployee={onEmployee}
              onNewTask={onNewTask}
            />
            <WeekList live={configured} onCalendar={onCalendar} />
          </section>
          <section className="office-2d-cell" aria-label={floor ? 'Floor work' : 'Unassigned work'}>
            <FloorWork
              tasks={tasks}
              proposals={proposals}
              canAssign={canAct && staff.length > 0}
              onTask={onTask}
              onNewTask={() => onNewTask()}
            />
            {!floor && (
              <button className="text-button office-2d-all" onClick={onAllTasks}>
                All tasks <ArrowRight size={14} />
              </button>
            )}
          </section>
          {board && (
            <section className="office-2d-cell office-2d-board" aria-label="Floor channel">
              <div className="section-title">
                <h3>Board</h3>
              </div>
              {board}
            </section>
          )}
        </div>
        {(feeds || binder) && (
          <div className="office-2d-grid office-2d-lower">
            {feeds && (
              <section className="office-2d-cell" aria-label="Instance feeds">
                <div className="section-title">
                  <h3>Feeds</h3>
                </div>
                {feeds}
              </section>
            )}
            {binder && (
              <section className="office-2d-cell" aria-label="Floor memory binder">
                <div className="section-title">
                  <h3>Binder</h3>
                </div>
                {binder}
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function FloorHeader({
  entry,
  staff,
  configured,
  onEditFloor,
  onArchive,
  onNewTask,
}: {
  entry: FloorEntry | null;
  staff: Employee[];
  configured: boolean;
  onEditFloor: () => void;
  onArchive: (archived: boolean) => void;
  onNewTask: () => void;
}) {
  const floor = entry?.floor ?? null;
  const summary: FloorSummary | undefined = entry?.summary;
  const archived = Boolean(floor?.archivedAt);
  return (
    <header className="floor-heading">
      <div>
        <span className="eyebrow">
          {floor ? (archived ? 'ARCHIVED FLOOR' : `FLOOR ${Number(entry!.number)}`) : 'GROUND FLOOR'}
        </span>
        <h2>{floor ? floor.name : 'Lobby'}</h2>
        <p>{floor ? floor.brief : 'Employees not yet on a floor, and tasks without one.'}</p>
        {floor && summary && (
          <div className="floor-meta">
            <span className="staff-avatars" aria-label={`${staff.length} staffed`}>
              {staff.slice(0, 6).map((employee) => (
                <Avatar key={employee.id} employee={employee} />
              ))}
              {staff.length > 6 && <em>+{staff.length - 6}</em>}
            </span>
            <small>
              {staff.length} staffed · {summary.active} active · updated {relativeTime(summary.lastActivity)}
            </small>
            {floor.openHandoffs > 0 && (
              <span className="handoff-badge">{pluralize(floor.openHandoffs, 'open handoff')}</span>
            )}
          </div>
        )}
      </div>
      <div className="floor-heading-actions">
        <button
          className="primary-button compact"
          disabled={!configured || archived || !staff.some((employee) => employee.status === 'ready')}
          onClick={onNewTask}
        >
          <Plus size={14} /> Assign work
        </button>
        {floor && (
          <>
            <button className="secondary-button compact" onClick={onEditFloor}>
              <Pencil size={14} /> Edit
            </button>
            <button
              className="secondary-button compact"
              disabled={!configured}
              onClick={() => onArchive(!archived)}
            >
              {archived ? <RotateCcw size={14} /> : <Archive size={14} />}
              {archived ? 'Restore' : 'Archive'}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
