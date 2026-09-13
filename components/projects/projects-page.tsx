'use client';

import { FolderKanban, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { PageProps } from '../app/page-props';
import { EmptyPane, EmptySection } from '../shared/empty';
import { HireSheet, hireContext } from '../shared/hire-sheet';
import { MasterDetail, useMasterDetail } from '../shared/master-detail';
import { PageIntro } from '../shared/page-intro';
import { SkeletonList } from '../shared/skeleton';
import { useUiQuery } from '../shared/use-ui-query';
import { NewProjectSheet } from './new-project-sheet';
import { ProjectCard } from './project-card';
import { ProjectDetail } from './project-detail';
import { ProjectionNote } from './projection-note';
import type { HireSuggestion } from './proposal-questions';
import { ProposalReview } from './proposal-review';
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
  const { open, openDetail, closeDetail } = useMasterDetail();

  const projects = useUiQuery(uiApi.projects, {});
  const shown = (projects ?? []).filter((project) => filter === 'all' || OPEN.includes(project.status));
  const selectedId = shown.some((project) => project.id === selectedProject)
    ? selectedProject
    : (shown[0]?.id ?? null);
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
      if (created) {
        onSelectProject(created.projectId);
        openDetail();
      }
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
        eyebrow="ROADMAPS"
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
      ) : (
        <MasterDetail
          className="project-layout card"
          open={open}
          backLabel="Projects"
          onBack={closeDetail}
          list={
            <div className="project-list">
              <div className="pane-toolbar">
                <strong>{pluralize(shown.length, 'project')}</strong>
                <div className="segmented">
                  <button data-active={filter === 'open'} onClick={() => setFilter('open')}>
                    Open
                  </button>
                  <button data-active={filter === 'all'} onClick={() => setFilter('all')}>
                    All
                  </button>
                </div>
              </div>
              <ProjectionNote projection={projection} />
              {projects ? (
                shown.map((entry) => (
                  <ProjectCard
                    key={entry.id}
                    project={entry}
                    floors={dashboard.floors}
                    active={entry.id === selectedId}
                    onSelect={() => {
                      onSelectProject(entry.id);
                      openDetail();
                    }}
                  />
                ))
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
          }
          detail={
            project ? (
              project.proposal ? (
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
                  onReplan={() =>
                    perform(() => actions.replanProject(project.id), 'Replanning this project.')
                  }
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
              )
            ) : (
              <EmptyPane
                icon={<FolderKanban size={22} />}
                title="No project selected"
                text="Choose a project to see its roadmap, its milestones, and its channel."
              />
            )
          }
        />
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
