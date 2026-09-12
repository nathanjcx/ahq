'use client';

import { AlertTriangle } from 'lucide-react';
import { shortDate } from '../shared/time';
import { nextDeadline } from './roadmap';
import type { Floor, Project, ProjectStatus } from '@/lib/contracts';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  done: 'Finished',
  archived: 'Archived',
};

export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span className="project-status" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A project in the list: where it stands, what it spans, and the next date that matters. */
export function ProjectCard({
  project,
  floors,
  active,
  onSelect,
}: {
  project: Project;
  floors: Floor[];
  active: boolean;
  onSelect: () => void;
}) {
  const done = project.milestones.filter((milestone) => milestone.status === 'done').length;
  const deadline = nextDeadline(project);
  const names = project.floorIds
    .map((id) => floors.find((floor) => floor.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return (
    <button className="project-card" data-active={active} onClick={onSelect}>
      <header>
        <strong>{project.name}</strong>
        <ProjectStatusPill status={project.status} />
      </header>
      <p>{project.brief}</p>
      <div className="project-card-facts">
        <span>
          {done}/{project.milestones.length} milestones
        </span>
        <span>{project.openTasks} open</span>
        <span>{deadline ? `Due ${shortDate(deadline)}` : 'No deadline'}</span>
      </div>
      <div className="project-card-floors">
        {names.length ? names.map((name) => <span key={name}>{name}</span>) : <span>No floors</span>}
      </div>
      {project.behindMilestones > 0 && (
        <p className="project-card-behind">
          <AlertTriangle size={14} />
          {project.behindMilestones} behind
        </p>
      )}
    </button>
  );
}
