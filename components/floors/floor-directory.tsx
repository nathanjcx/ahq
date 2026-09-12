'use client';

import { Archive, Building2, ChevronRight } from 'lucide-react';
import type { Project } from '@/lib/contracts';

export function FloorDirectory({
  workspaceName,
  orderedProjects,
  selectedProjectId,
  unassignedTaskCount,
  canCreate,
  onSelectProject,
  onNewProject,
}: {
  workspaceName?: string;
  orderedProjects: Project[];
  selectedProjectId: string | null;
  unassignedTaskCount: number;
  canCreate: boolean;
  onSelectProject: (id: string | null) => void;
  onNewProject: () => void;
}) {
  const activeProjects = orderedProjects.filter((project) => !project.archivedAt);
  const archivedProjects = orderedProjects.filter((project) => project.archivedAt);
  const floorNumber = (project: Project) =>
    String(orderedProjects.findIndex((entry) => entry.id === project.id) + 1).padStart(2, '0');

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
            <strong>Lobby</strong>
            <small>{unassignedTaskCount} unassigned tasks</small>
          </span>
          <ChevronRight size={14} />
        </button>
        {activeProjects.map((project) => (
          <button
            key={project.id}
            data-active={selectedProjectId === project.id}
            aria-pressed={selectedProjectId === project.id}
            onClick={() => onSelectProject(project.id)}
          >
            <span className="floor-number">{floorNumber(project)}</span>
            <span>
              <strong>{project.name}</strong>
              <small>
                {project.employeeIds.length} {project.employeeIds.length === 1 ? 'employee' : 'employees'}
              </small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {!activeProjects.length && (
        <div className="directory-empty">
          <p>Create a floor for each project, then staff it with the employees it needs.</p>
          <button className="text-button" onClick={onNewProject} disabled={!canCreate}>
            Add first floor
          </button>
        </div>
      )}
      {archivedProjects.length > 0 && (
        <div className="directory-archive">
          <span>ARCHIVED</span>
          {archivedProjects.map((project) => (
            <button
              key={project.id}
              data-active={selectedProjectId === project.id}
              aria-pressed={selectedProjectId === project.id}
              onClick={() => onSelectProject(project.id)}
            >
              <Archive size={13} />
              <span>
                {floorNumber(project)} · {project.name}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="directory-footer">
        <span>{activeProjects.length}</span>
        <p>active project {activeProjects.length === 1 ? 'floor' : 'floors'}</p>
      </div>
    </aside>
  );
}
