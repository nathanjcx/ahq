import { auditApi } from './audit';
import { calendarApi } from './calendar';
import { channelsApi } from './channels';
import { coreApi } from './core';
import { meetingsApi } from './meetings';
import { memoryApi } from './memory';
import { projectsApi } from './projects';
import { scheduleApi } from './schedule';
import { triageApi } from './triage';

/**
 * Every Convex function the interface calls, under the names the UI uses. Each domain owns its own
 * file; the references are the generated ones, so a renamed or re-shaped function fails the build.
 */
export const uiApi = {
  ...coreApi,
  ...projectsApi,
  ...scheduleApi,
  ...calendarApi,
  ...meetingsApi,
  ...channelsApi,
  ...memoryApi,
  ...auditApi,
  ...triageApi,
} as const;

export { asId } from './core';
export type { AdminDraft } from './core';
