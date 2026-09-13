'use client';

import { ChevronLeft, ChevronRight, FolderKanban, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { EmptyPane, EmptySection } from '../shared/empty';
import { HireSheet, hireContext } from '../shared/hire-sheet';
import { PageIntro } from '../shared/page-intro';
import { SkeletonList } from '../shared/skeleton';
import { shortDate } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import { NewProjectSheet } from './new-project-sheet';
import { ProjectStatusPill } from './project-card';
import { ProjectDetail } from './project-detail';
import { ProjectionNote } from './projection-note';
import type { HireSuggestion } from './proposal-questions';
import { ProposalReview } from './proposal-review';
import { nextDeadline } from './roadmap';
import { pluralize } from '@/lib/text';
import { asId, uiApi } from '@/lib/ui-api';
import './projects.css';

/** Statuses the Open filter keeps: work that still needs someone's attention. */
const OPEN = ['planning', 'active'];

/** While the planner turn runs there is nothing to show but the fact that it is running. */
function PlannerWorking({ name }: { name: string }) {
  return (
    <div className="planner-working">
      <div className="section-title">
        <Sparkles size={16} />
        <h2>The planner is working on {name}</h2>
      </div>
      <p>
        It is reading the brief, the floors, and what your employees have done before, and will come back with
        milestones, tasks, and the questions it needs answered.
      </p>
      <SkeletonList kind="entry" rows={3} label="Planning" />
    </div>
  );
}

export function ProjectsPage({
  dashboard,
  actions,
  configured,
  run,
  go,
  selectedProject,
  onSelectProject,
  onSelectTask,
}: PageProps) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [composing, setComposing] = useState(false);
  const [hiring, setHiring] = useState<HireSuggestion | null>(null);
  const [busy, setBusy] = useState(false);

  const projects = useUiQuery(uiApi.projects, {});
  const shown = (projects ?? []).filter((project) => filter === 'all' || OPEN.includes(project.status));
  const selectedId = (projects ?? []).some((project) => project.id === selectedProject)
    ? selectedProject
    : null;
  const projectArgs = selectedId ? { projectId: asId<'projects'>(selectedId) } : 'skip';
  const project = useUiQuery(uiApi.project, projectArgs);
  const tasks = useUiQuery(uiApi.projectTasks, projectArgs);
  // Hiring answers a capacity question, and the marketplace is what can be hired.
  const listings = useUiQuery(uiApi.listings, {});
  const projection = useUiQuery(uiApi.planProjection, {
    projectedTokens: project?.proposal?.projectedTokens ?? 0,
  });

  /** Runs one mutation, keeping the page's controls disabled until it settles. */
  const perform = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      return await run(work, success);
    } finally {
      setBusy(false);
    }
  };
  const openTask = (taskId: string) => {
    onSelectTask(taskId);
    go('tasks');
  };
  const create = async (name: string, brief: string, floorIds: string[], deadlineAt?: number) => {
    setBusy(true);
    try {
      const created = await actions.createProject(name, brief, floorIds, deadlineAt);
      if (created) onSelectProject(created.projectId);
      setComposing(false);
    } finally {
      setBusy(false);
    }
  };

  const floors = dashboard.floors.filter((floor) => !floor.archivedAt);
  const { needsApproval } = hireContext(dashboard);
  const hiringListing = listings?.find((listing) => listing.listingId === hiring?.listingId);
  const newProject = (
    <button className="primary-button" disabled={!configured} onClick={() => setComposing(true)}>
      <Plus size={17} />
      New project
    </button>
  );

  return (
    <div>
      <PageIntro
        title="Projects"
        description="Roadmaps that span floors, with milestones and who is on them."
        action={newProject}
      />
      {projects && !projects.length ? (
        <EmptySection
          icon={<FolderKanban size={28} />}
          title="No projects yet"
          text="Describe an outcome and the floors that can reach it. The planner proposes the roadmap; you confirm it."
          action={newProject}
        />
      ) : selectedId && project ? (
        <div className="detail-page">
          <button className="detail-back" onClick={() => onSelectProject(null)}>
            <ChevronLeft size={16} /> Projects
          </button>
          {project.proposal ? (
            <ProposalReview
              key={project.id}
              project={project}
              proposal={project.proposal}
              floors={dashboard.floors}
              employees={dashboard.employees}
              listings={listings ?? []}
              projection={projection}
              busy={busy}
              onSave={(proposal) =>
                perform(() => actions.saveRoadmapProposal(project.id, proposal), 'Roadmap edits saved.')
              }
              onConfirm={(proposal) =>
                perform(
                  () => actions.confirmRoadmap(project.id, proposal),
                  'Roadmap confirmed. The work is on the calendar.',
                )
              }
              onHire={setHiring}
            />
          ) : project.status === 'planning' ? (
            <PlannerWorking name={project.name} />
          ) : (
            <ProjectDetail
              project={project}
              tasks={tasks ?? []}
              floors={dashboard.floors}
              actions={actions}
              busy={busy}
              onOpenTask={openTask}
              onReplan={() => perform(() => actions.replanProject(project.id), 'Replanning this project.')}
              onArchive={() => perform(() => actions.archiveProject(project.id), 'Project archived.')}
              onFinish={() =>
                perform(() => actions.setProjectStatus(project.id, 'done'), 'Project marked finished.')
              }
              onProjectDeadline={(deadlineAt) =>
                perform(
                  () =>
                    actions.updateProject(
                      project.id,
                      project.name,
                      project.brief,
                      project.floorIds,
                      deadlineAt,
                    ),
                  deadlineAt ? 'Deadline set.' : 'Deadline cleared.',
                )
              }
              onDeadline={(taskId, deadlineAt) =>
                perform(() => actions.setTaskDeadline(taskId, deadlineAt), 'Deadline changed.')
              }
              onCadence={(taskId, cadence) =>
                perform(() => actions.setTaskCadence(taskId, cadence), 'Cadence changed.')
              }
              onUnblock={(taskId) => perform(() => actions.unblockTask(taskId), 'Task released.')}
            />
          )}
        </div>
      ) : (
        <div className="card data-table-wrap">
          <div className="table-toolbar">
            <strong>{pluralize(shown.length, 'project')}</strong>
            <div className="segmented">
              <button aria-selected={filter === 'open'} onClick={() => setFilter('open')}>
                Open
              </button>
              <button aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
            </div>
          </div>
          <ProjectionNote projection={projection} />
          {projects ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="hide-sm">Floors</th>
                  <th className="hide-sm">Milestones</th>
                  <th className="num hide-sm">Open tasks</th>
                  <th className="hide-sm">Deadline</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => {
                  const done = entry.milestones.filter((milestone) => milestone.status === 'done').length;
                  const deadline = nextDeadline(entry);
                  const names = entry.floorIds
                    .map((id) => dashboard.floors.find((floor) => floor.id === id)?.name)
                    .filter((name): name is string => Boolean(name));
                  return (
                    <tr
                      key={entry.id}
                      className="row-link"
                      tabIndex={0}
                      onClick={() => onSelectProject(entry.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectProject(entry.id);
                        }
                      }}
                    >
                      <td>
                        <span className="who">
                          <span>
                            <b>{entry.name}</b>
                            <small>{entry.brief}</small>
                          </span>
                        </span>
                      </td>
                      <td className={names.length ? 'hide-sm' : 'dim hide-sm'}>
                        {names.join(', ') || 'No floors'}
                      </td>
                      <td className="dim hide-sm">
                        {done}/{entry.milestones.length}
                        {entry.behindMilestones ? ` · ${entry.behindMilestones} behind` : ''}
                      </td>
                      <td className="num dim hide-sm">{entry.openTasks}</td>
                      <td className="dim hide-sm">{deadline ? shortDate(deadline) : '—'}</td>
                      <td>
                        <ProjectStatusPill status={entry.status} />
                      </td>
                      <td className="chev">
                        <ChevronRight size={16} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <SkeletonList kind="entry" rows={3} label="Loading projects" />
          )}
          {projects && !shown.length && (
            <EmptyPane
              icon={<FolderKanban size={22} />}
              title="Nothing open"
              text="Every project here is finished or archived. Switch to All to see them."
            />
          )}
        </div>
      )}
      {hiring && hiringListing && (
        <HireSheet
          listing={hiringListing}
          dashboard={dashboard}
          floorId={hiring.floorId}
          count={hiring.count}
          onClose={() => setHiring(null)}
          onHire={(options) =>
            run(
              () => actions.hire(hiring.listingId, options),
              needsApproval
                ? 'Requested. An owner or an administrator decides it.'
                : `Hired ${pluralize(options.count ?? 1, 'instance')} of ${hiring.name}.`,
            )
          }
        />
      )}
      {composing && (
        <NewProjectSheet
          floors={floors}
          employees={dashboard.employees}
          busy={busy}
          onClose={() => setComposing(false)}
          onCreate={create}
        />
      )}
    </div>
  );
}
