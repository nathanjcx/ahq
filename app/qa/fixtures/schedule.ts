import type { FixtureQueries } from '@/components/shared/use-ui-query';
import type { PlanProjection, ScheduleSummary, WorkspaceSettings } from '@/lib/contracts';

/** A workspace whose administrator has already moved the hours off the defaults. */
const settings: WorkspaceSettings = {
  timezone: 'America/New_York',
  workingDays: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 19,
  attendedStartHour: 10,
  attendedEndHour: 16,
  overnightPolicy: 'cheap',
  dailyTokenCap: 400_000,
  triageAllowance: 750_000,
  memoryBudgets: { workspace: 2_000, project: 3_000, floor: 4_000, agent: 1_500, summaries: 1_500 },
  hiringPolicy: 'approval',
  auditPolicy: 'soft',
  triageAllowList: ['create_pull_request', 'create_issue_comment'],
  emergencyAllowList: ['merge_pull_request'],
  notificationChannels: ['in_app', 'push', 'slack'],
  plan: 'subscription',
  monthlyAllowance: 8_000_000,
  maxConcurrentInstances: 6,
  rates: [{ model: 'gpt-6-astra', input: 0.000003, cached: 0.0000003, output: 0.000015 }],
  standards:
    'Copy: say what changed and what the reader has to do, in that order. No exclamation marks, no “simply”.\n\nCode: one concern per module, no dead branches, and a test for anything a person could get wrong twice.',
  updatedAt: Date.UTC(2026, 2, 16, 17, 5),
};

const summary: ScheduleSummary = {
  timezone: settings.timezone,
  workingDays: settings.workingDays,
  startHour: settings.startHour,
  endHour: settings.endHour,
  attendedStartHour: settings.attendedStartHour,
  attendedEndHour: settings.attendedEndHour,
  overnightPolicy: settings.overnightPolicy,
  working: true,
  attended: true,
  usageToday: { input: 182_400, cached: 96_100, output: 24_300, cap: settings.dailyTokenCap },
};

const projection: PlanProjection = {
  plan: 'subscription',
  usedTokens: 1_141_000,
  projectedTokens: 0,
  monthlyAllowance: settings.monthlyAllowance,
  allowanceUsed: 0.143,
  overAllowance: false,
  unpricedModels: ['gpt-5.6-terra', 'gpt-5.6-luna'],
  capacity: { instances: 8, maxConcurrentInstances: 6, runningShifts: 3, freeSlots: 3 },
};

export const scheduleQueries: FixtureQueries = {
  'schedule:settings': settings,
  'schedule:summary': summary,
  'plan:projection': projection,
};
