import type { FunctionReturnType } from 'convex/server';
import { expectTypeOf, test } from 'vitest';
import { type api } from '../convex/_generated/api';
import type { Project, ProjectTask, RoadmapProposal } from '../lib/contracts';
import { projectsApi } from '../lib/ui-api/projects';

/**
 * The projects pages render `Project` and `RoadmapProposal`. These assertions fail the build the
 * moment a Convex function stops producing them, rather than in the browser.
 */
test('the project queries satisfy their UI contracts', () => {
  expectTypeOf<FunctionReturnType<typeof api.projects.list>>().toExtend<Project[]>();
  expectTypeOf<FunctionReturnType<typeof api.projects.get>>().toExtend<Project>();
  expectTypeOf<FunctionReturnType<typeof api.projects.get>['proposal']>().toExtend<
    RoadmapProposal | undefined
  >();
  expectTypeOf<FunctionReturnType<typeof api.projects.tasks>>().toExtend<ProjectTask[]>();
});

/** The interface reaches every project and planning function through its own name. */
test('the projects domain exposes the names the interface uses', () => {
  expectTypeOf(projectsApi).toHaveProperty('projects');
  expectTypeOf(projectsApi).toHaveProperty('projectTasks');
  expectTypeOf(projectsApi).toHaveProperty('confirmRoadmap');
  expectTypeOf(projectsApi).toHaveProperty('unblockTask');
});
