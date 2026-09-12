import { api } from '@/convex/_generated/api';

/** Convex references for the schedule domain. The generated references keep the names honest. */
export const scheduleApi = {
  workspaceSettings: api.schedule.settings,
  updateWorkspaceSettings: api.schedule.updateSettings,
  scheduleSummary: api.schedule.summary,
  planProjection: api.plan.projection,
} as const;
