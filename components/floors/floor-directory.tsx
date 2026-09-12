'use client';

import { Archive, Building2, ChevronRight } from 'lucide-react';
import { relativeTime } from '../shared/format';
import { countsLabel, type FloorEntry } from './floor-stats';

export function FloorDirectory({
  workspaceName,
  activeFloors,
  archivedFloors,
  selectedProjectId,
  unassignedTaskCount,
  canCreate,
  onSelectProject,
  onNewProject,
}: {
  workspaceName?: string;
  /** Active floors, most recently active first. */
  activeFloors: FloorEntry[];
  archivedFloors: FloorEntry[];
  selectedProjectId: string | null;
  unassignedTaskCount: number;
  canCreate: boolean;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
}) {
  return (
    <aside className="floor-directory card" aria-label="Building directory">
      <div className="directory-head">
        <span className="building-mark" aria-hidden="true">
          <Building2 size={19} />
        </span>
        <div>
          <span className="eyebrow">BUILDING DIRECTORY</span>
          <h2>{workspaceName || 'Astra HQ'}</h2>
        </div>
      </div>
      <div className="directory-list">
        <button
          data-active={!selectedProjectId}
          aria-pressed={!selectedProjectId}
          onClick={() => onSelectProject(null)}
        >
          <span className="floor-number">L</span>
          <span>
            <strong>
              <span>Lobby</span>
            </strong>
            <small>{unassignedTaskCount} unassigned tasks</small>
          </span>
          <ChevronRight size={14} />
        </button>
        {activeFloors.map(({ project, number, summary }) => (
          <button
            key={project.id}
            data-active={selectedProjectId === project.id}
            aria-pressed={selectedProjectId === project.id}
            onClick={() => onSelectProject(project.id)}
          >
            <span className="floor-number">{number}</span>
            <span>
              <strong>
                <span>{project.name}</span>
                {project.openHandoffs > 0 && (
                  <em className="handoff-badge" title={`${project.openHandoffs} open handoffs`}>
                    {project.openHandoffs}
                  </em>
                )}
              </strong>
              <small>{countsLabel(summary)}</small>
              <small>{relativeTime(summary.lastActivity)}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {!activeFloors.length && (
        <div className="directory-empty">
          <p>Create a floor for each project, then staff it with the employees it needs.</p>
          <button className="text-button" onClick={onNewProject} disabled={!canCreate}>
            Add first floor
          </button>
        </div>
      )}
      {archivedFloors.length > 0 && (
        <div className="directory-archive">
          <span>ARCHIVED</span>
          {archivedFloors.map(({ project, number }) => (
            <button
              key={project.id}
              data-active={selectedProjectId === project.id}
              aria-pressed={selectedProjectId === project.id}
              onClick={() => onSelectProject(project.id)}
            >
              <Archive size={13} />
              <span>
                {number} · {project.name}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="directory-footer">
        <span>{activeFloors.length}</span>
        <p>active project {activeFloors.length === 1 ? 'floor' : 'floors'}</p>
      </div>
    </aside>
  );
}
