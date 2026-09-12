import { api } from '@/convex/_generated/api';

/** Convex references for the projects domain: roadmaps, milestones, and the task dependency graph. */
export const projectsApi = {
  // Projects and roadmaps
  projects: api.projects.list,
  project: api.projects.get,
  projectTasks: api.projects.tasks,
  createProject: api.projects.create,
  updateProject: api.projects.update,
  setProjectStatus: api.projects.setStatus,
  saveRoadmapProposal: api.projects.saveProposal,
  confirmRoadmap: api.projects.confirmProposal,
  replanProject: api.projects.replan,
  archiveProject: api.projects.archive,

  // Task planning
  setTaskDependencies: api.tasks.setDependencies,
  setTaskDeadline: api.tasks.setDeadline,
  setTaskCadence: api.tasks.setCadence,
  unblockTask: api.tasks.unblock,
} as const;
