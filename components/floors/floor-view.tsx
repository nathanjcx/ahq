'use client';

import { Archive, Pencil, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ActionProposal, Employee, Project, Task } from '@/lib/contracts';
import type { OfficeEmployee } from '../office/office-view';
import { Avatar } from '../shared/marks';
import { relativeTime } from '../shared/format';
import { FloorTeam } from './floor-team';
import { FloorWork } from './floor-work';
import type { FloorSummary } from './floor-stats';

type Region = 'board' | 'work' | 'team';

const REGIONS: { id: Region; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'work', label: 'Work' },
  { id: 'team', label: 'Team' },
];

const BRIEF_CLAMP = 220;

export function FloorView({
  project,
  floorLabel,
  summary,
  staff,
  officeEmployees,
  tasks,
  proposals,
  board,
  configured,
  onEmployee,
  onTask,
  onNewTask,
  onEditProject,
  onArchive,
}: {
  project: Project;
  floorLabel: string;
  summary: FloorSummary;
  staff: Employee[];
  officeEmployees: OfficeEmployee[];
  tasks: Task[];
  proposals: ActionProposal[];
  /** The board for this floor, supplied by the page so this view stays independent of its data source. */
  board: ReactNode;
  configured: boolean;
  onEmployee: (id: string) => void;
  onTask: (id: string) => void;
  onNewTask: (employeeId?: string) => void;
  onEditProject: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const [region, setRegion] = useState<Region>('board');
  const [briefOpen, setBriefOpen] = useState(false);
  const archived = Boolean(project.archivedAt);
  const canAct = configured && !archived;

  return (
    <section className="floor-workspace card">
      <header className="floor-heading">
        <div>
          <span className="eyebrow">{archived ? 'ARCHIVED FLOOR' : floorLabel.toUpperCase()}</span>
          <h2>{project.name}</h2>
          <p className={briefOpen ? 'brief-open' : undefined}>{project.brief}</p>
          {project.brief.length > BRIEF_CLAMP && (
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
              {staff.length} staffed · {summary.active} active · updated {relativeTime(summary.lastActivity)}
            </small>
            {project.openHandoffs > 0 && (
              <span className="handoff-badge">
                {project.openHandoffs} open {project.openHandoffs === 1 ? 'handoff' : 'handoffs'}
              </span>
            )}
            {archived && <span className="archived-badge">Archived</span>}
          </div>
        </div>
        <div className="floor-heading-actions">
          <button className="secondary-button compact" onClick={onEditProject}>
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
        <section className="floor-region region-board" aria-label="Floor board">
          {board}
        </section>
        <section className="floor-region region-team" aria-label="Floor team">
          <FloorTeam
            floorName={`${floorLabel} · ${project.name}`}
            archived={archived}
            staff={staff}
            officeEmployees={officeEmployees}
            canAssign={canAct}
            onEmployee={onEmployee}
            onNewTask={onNewTask}
            onEditProject={onEditProject}
          />
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
