'use client';

import { useMutation } from 'convex/react';
import type { ProjectStatus, RoadmapProposal } from '@/lib/contracts';
import { asId, uiApi } from '@/lib/ui-api';

/** Everything the projects pages change: the project, its roadmap, and the tasks a roadmap created. */
export type ProjectsActions = {
  createProject: (
    name: string,
    brief: string,
    floorIds: string[],
    deadlineAt?: number,
  ) => Promise<{ projectId: string } | undefined>;
  updateProject: (
    projectId: string,
    name: string,
    brief: string,
    floorIds: string[],
    deadlineAt?: number,
  ) => Promise<unknown>;
  setProjectStatus: (projectId: string, status: ProjectStatus) => Promise<unknown>;
  saveRoadmapProposal: (projectId: string, proposal: RoadmapProposal) => Promise<unknown>;
  confirmRoadmap: (projectId: string, proposal: RoadmapProposal) => Promise<unknown>;
  replanProject: (projectId: string) => Promise<unknown>;
  archiveProject: (projectId: string) => Promise<unknown>;
  setTaskDependencies: (taskId: string, dependsOn: string[]) => Promise<unknown>;
  setTaskDeadline: (taskId: string, deadlineAt?: number) => Promise<unknown>;
  setTaskCadence: (taskId: string, cadence: 'once' | 'daily') => Promise<unknown>;
  unblockTask: (taskId: string) => Promise<unknown>;
};

const unavailable = async () => undefined;

/** Preview mode: every mutation is a no-op so the interface stays explorable. */
export const offlineProjectsActions: ProjectsActions = {
  createProject: unavailable,
  updateProject: unavailable,
  setProjectStatus: unavailable,
  saveRoadmapProposal: unavailable,
  confirmRoadmap: unavailable,
  replanProject: unavailable,
  archiveProject: unavailable,
  setTaskDependencies: unavailable,
  setTaskDeadline: unavailable,
  setTaskCadence: unavailable,
  unblockTask: unavailable,
};

export function useProjectsActions(): ProjectsActions {
  const createProject = useMutation(uiApi.createProject);
  const updateProject = useMutation(uiApi.updateProject);
  const setProjectStatus = useMutation(uiApi.setProjectStatus);
  const saveRoadmapProposal = useMutation(uiApi.saveRoadmapProposal);
  const confirmRoadmap = useMutation(uiApi.confirmRoadmap);
  const replanProject = useMutation(uiApi.replanProject);
  const archiveProject = useMutation(uiApi.archiveProject);
  const setTaskDependencies = useMutation(uiApi.setTaskDependencies);
  const setTaskDeadline = useMutation(uiApi.setTaskDeadline);
  const setTaskCadence = useMutation(uiApi.setTaskCadence);
  const unblockTask = useMutation(uiApi.unblockTask);

  return {
    createProject: async (name, brief, floorIds, deadlineAt) => {
      const { projectId } = await createProject({
        name,
        brief,
        floorIds: floorIds.map((id) => asId<'floors'>(id)),
        deadlineAt,
      });
      return { projectId: String(projectId) };
    },
    updateProject: (projectId, name, brief, floorIds, deadlineAt) =>
      updateProject({
        projectId: asId(projectId),
        name,
        brief,
        floorIds: floorIds.map((id) => asId<'floors'>(id)),
        deadlineAt,
      }),
    setProjectStatus: (projectId, status) => setProjectStatus({ projectId: asId(projectId), status }),
    saveRoadmapProposal: (projectId, proposal) =>
      saveRoadmapProposal({ projectId: asId(projectId), proposal }),
    confirmRoadmap: (projectId, proposal) => confirmRoadmap({ projectId: asId(projectId), proposal }),
    replanProject: (projectId) => replanProject({ projectId: asId(projectId) }),
    archiveProject: (projectId) => archiveProject({ projectId: asId(projectId) }),
    setTaskDependencies: (taskId, dependsOn) =>
      setTaskDependencies({ taskId: asId(taskId), dependsOn: dependsOn.map((id) => asId<'tasks'>(id)) }),
    setTaskDeadline: (taskId, deadlineAt) => setTaskDeadline({ taskId: asId(taskId), deadlineAt }),
    setTaskCadence: (taskId, cadence) => setTaskCadence({ taskId: asId(taskId), cadence }),
    unblockTask: (taskId) => unblockTask({ taskId: asId(taskId) }),
  };
}
