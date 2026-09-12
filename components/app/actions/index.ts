'use client';

import { type CoreActions, offlineCoreActions, useCoreActions } from './core';
import { type ProjectsActions, offlineProjectsActions, useProjectsActions } from './projects';
import { type ScheduleActions, offlineScheduleActions, useScheduleActions } from './schedule';
import { type CalendarActions, offlineCalendarActions, useCalendarActions } from './calendar';
import { type MeetingsActions, offlineMeetingsActions, useMeetingsActions } from './meetings';
import { type ChannelsActions, offlineChannelsActions, useChannelsActions } from './channels';
import { type MemoryActions, offlineMemoryActions, useMemoryActions } from './memory';
import { type AuditActions, offlineAuditActions, useAuditActions } from './audit';
import { type TriageActions, offlineTriageActions, useTriageActions } from './triage';

export type { CorrectionResult } from './core';

/** Every workspace mutation the UI can perform, in UI terms. Each domain owns its own file. */
export type Actions = CoreActions &
  ProjectsActions &
  ScheduleActions &
  CalendarActions &
  MeetingsActions &
  ChannelsActions &
  MemoryActions &
  AuditActions &
  TriageActions;

/** Preview mode: every mutation is a no-op so the interface stays explorable. */
export const offlineActions: Actions = {
  ...offlineCoreActions,
  ...offlineProjectsActions,
  ...offlineScheduleActions,
  ...offlineCalendarActions,
  ...offlineMeetingsActions,
  ...offlineChannelsActions,
  ...offlineMemoryActions,
  ...offlineAuditActions,
  ...offlineTriageActions,
};

export function useWorkspaceActions(): Actions {
  return {
    ...useCoreActions(),
    ...useProjectsActions(),
    ...useScheduleActions(),
    ...useCalendarActions(),
    ...useMeetingsActions(),
    ...useChannelsActions(),
    ...useMemoryActions(),
    ...useAuditActions(),
    ...useTriageActions(),
  };
}
