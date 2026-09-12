'use client';

import { useMutation } from 'convex/react';
import type { WorkspaceSettings } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/** Settings are saved whole, so a partial write can never leave the hours inconsistent. */
export type SettingsInput = Omit<WorkspaceSettings, 'updatedAt'>;

export type ScheduleActions = {
  saveWorkspaceSettings: (settings: SettingsInput) => Promise<unknown>;
};

export const offlineScheduleActions: ScheduleActions = {
  saveWorkspaceSettings: async () => undefined,
};

export function useScheduleActions(): ScheduleActions {
  const updateSettings = useMutation(uiApi.updateWorkspaceSettings);
  // Named field by field: the settings query also carries what the mutation does not accept, and
  // Convex refuses an argument it did not declare.
  return {
    saveWorkspaceSettings: (settings) =>
      updateSettings({
        timezone: settings.timezone,
        workingDays: settings.workingDays,
        startHour: settings.startHour,
        endHour: settings.endHour,
        attendedStartHour: settings.attendedStartHour,
        attendedEndHour: settings.attendedEndHour,
        overnightPolicy: settings.overnightPolicy,
        dailyTokenCap: settings.dailyTokenCap,
        triageAllowance: settings.triageAllowance,
        memoryBudgets: settings.memoryBudgets,
        hiringPolicy: settings.hiringPolicy,
        auditPolicy: settings.auditPolicy,
        triageAllowList: settings.triageAllowList,
        emergencyAllowList: settings.emergencyAllowList,
        notificationChannels: settings.notificationChannels,
        plan: settings.plan,
        monthlyAllowance: settings.monthlyAllowance,
        maxConcurrentInstances: settings.maxConcurrentInstances,
        rates: settings.rates,
        standards: settings.standards,
      }),
  };
}
