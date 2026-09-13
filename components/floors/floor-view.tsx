'use client';

import { Archive, ChevronDown, Pencil, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { OfficeEmployee } from '../office/office-view';
import { Avatar } from '../shared/marks';
import { relativeTime } from '../shared/time';
import type { FloorSummary } from './floor-stats';
import { FloorTeam } from './floor-team';
import { FloorWork } from './floor-work';
import type { ActionProposal, Dashboard, Employee, Floor, ScheduleSummary, Task } from '@/lib/contracts';
import { pluralize } from '@/lib/text';

type Region = 'board' | 'feeds' | 'work' | 'team' | 'binder';

const REGIONS: { id: Region; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'feeds', label: 'Feeds' },
  { id: 'work', label: 'Work' },
  { id: 'team', label: 'Team' },
  { id: 'binder', label: 'Binder' },
];

const BRIEF_CLAMP = 220;

export function FloorView({
  floor,
  dashboard,
  floorLabel,
  summary,
  staff,
  officeEmployees,
  tasks,
  proposals,
  schedule,
  board,
  feeds,
  binder,
  configured,
  onEmployee,
  onTask,
  onNewTask,
  onEditFloor,
  onCalendar,
  onArchive,
  replay,
}: {
  floor: Floor;
  /** The workspace the page is showing, for the office the team rail mounts. */
  dashboard: Dashboard;
  floorLabel: string;
  summary: FloorSummary;
  staff: Employee[];
  officeEmployees: OfficeEmployee[];
  tasks: Task[];
  proposals: ActionProposal[];
  /** The workspace's hours, so the team can say who is off shift. */
  schedule?: ScheduleSummary;
  /** This floor's channel, its instance feeds, and its memory binder, supplied by the page so this
   * view stays independent of their data sources. */
  board: ReactNode;
  feeds: ReactNode;
  binder: ReactNode;
  configured: boolean;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onNewTask: (employeeId?: string) => void;
  onEditFloor: () => void;
  onCalendar: () => void;
  onArchive: (archived: boolean) => void;
  /** An optional control for this floor's scene, shown beside Edit and Archive. */
  replay?: ReactNode;
}) {
  const [region, setRegion] = useState<Region>('board');
  const [briefOpen, setBriefOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const archived = Boolean(floor.archivedAt);
  const canAct = configured && !archived;

  return (
    <section className="floor-workspace card">
      <header className="floor-heading">
        <div>
          <span className="eyebrow">{archived ? 'ARCHIVED FLOOR' : floorLabel.toUpperCase()}</span>
          <h2>{floor.name}</h2>
          <button
            className="floor-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            Details
            <ChevronDown size={14} />
          </button>
          <div className="floor-details-body" data-open={detailsOpen}>
            <p className={briefOpen ? 'brief-open' : undefined}>{floor.brief}</p>
            {floor.brief.length > BRIEF_CLAMP && (
              <button className="text-button" onClick={() => setBriefOpen((open) => !open)}>
                {briefOpen ? 'Show less' : 'Show full brief'}
              </button>
            )}
            <div className="floor-meta">
              <span className="staff-avatars" aria-label={`${staff.length} staffed`}>
                {staff.slice(0, 6).map((employee) => (
                  <Avatar key={employee.id} employee={employee} />
                ))}
                {staff.length > 6 && <em>+{staff.length - 6}</em>}
              </span>
              <small>
                {staff.length} staffed · {summary.active} active · updated{' '}
                {relativeTime(summary.lastActivity)}
              </small>
              {floor.openHandoffs > 0 && (
                <span className="handoff-badge">{pluralize(floor.openHandoffs, 'open handoff')}</span>
              )}
              {archived && <span className="archived-badge">Archived</span>}
            </div>
          </div>
        </div>
        <div className="floor-heading-actions">
          {replay}
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
        </div>
      </header>

      <div className="floor-region-switch segmented" aria-label="Floor sections">
        {REGIONS.map((item) => (
          <button
            key={item.id}
            aria-pressed={region === item.id}
            data-active={region === item.id}
            onClick={() => setRegion(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="floor-regions" data-region={region}>
        <section className="floor-region region-board" aria-label="Floor channel">
          {board}
        </section>
        <section className="floor-region region-feeds" aria-label="Instance feeds">
          {feeds}
        </section>
        <section className="floor-region region-team" aria-label="Floor team">
          <FloorTeam
            floorName={`${floorLabel} · ${floor.name}`}
            floorId={floor.id}
            dashboard={dashboard}
            configured={configured}
            archived={archived}
            staff={staff}
            tasks={tasks}
            schedule={schedule}
            officeEmployees={officeEmployees}
            canAssign={canAct}
            onEmployee={onEmployee}
            onNewTask={onNewTask}
            onEditFloor={onEditFloor}
            onCalendar={onCalendar}
          />
        </section>
        <section className="floor-region region-binder" aria-label="Floor memory binder">
          {binder}
        </section>
        <section className="floor-region region-work" aria-label="Floor work">
          <FloorWork
            tasks={tasks}
            proposals={proposals}
            canAssign={canAct && staff.length > 0}
            onTask={onTask}
            onNewTask={() => onNewTask()}
          />
        </section>
      </div>
    </section>
  );
}
