import type { ModelId } from './core';
import type { MemoryBudgets } from './memory';
import type { OvernightPolicy } from './schedule';

export type HiringPolicy = 'anyone' | 'admins' | 'approval';
export type AuditPolicy = 'soft' | 'hard';
export type PlanKind = 'subscription' | 'byok';

export interface ModelRate {
  model: ModelId;
  input: number;
  cached: number;
  output: number;
}
/** Every workspace policy an admin edits in Settings. */
export interface WorkspaceSettings {
  timezone: string;
  workingDays: number[];
  startHour: number;
  endHour: number;
  attendedStartHour: number;
  attendedEndHour: number;
  overnightPolicy: OvernightPolicy;
  dailyTokenCap: number;
  triageAllowance: number;
  memoryBudgets: MemoryBudgets;
  hiringPolicy: HiringPolicy;
  auditPolicy: AuditPolicy;
  triageAllowList: string[];
  emergencyAllowList: string[];
  notificationChannels: string[];
  plan: PlanKind;
  monthlyAllowance: number;
  maxConcurrentInstances: number;
  rates: ModelRate[];
  standards: string;
  updatedAt: number;
}
export const defaultWorkspaceSettings: Omit<WorkspaceSettings, 'timezone' | 'updatedAt'> = {
  workingDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
  attendedStartHour: 9,
  attendedEndHour: 18,
  overnightPolicy: 'audits_only',
  dailyTokenCap: 0,
  triageAllowance: 500_000,
  memoryBudgets: { workspace: 2_000, project: 3_000, floor: 4_000, agent: 1_500, summaries: 1_500 },
  hiringPolicy: 'anyone',
  auditPolicy: 'soft',
  triageAllowList: [],
  emergencyAllowList: [],
  notificationChannels: ['in_app'],
  plan: 'subscription',
  monthlyAllowance: 0,
  maxConcurrentInstances: 4,
  rates: [],
  standards: '',
};

/** Instances and the parallelism a workspace has right now. One instance runs one shift. */
export interface Capacity {
  instances: number;
  maxConcurrentInstances: number;
  runningShifts: number;
  freeSlots: number;
}
/** What work would consume, against a subscription allowance or the workspace's own rates. */
export interface PlanProjection {
  plan: PlanKind;
  /** Tokens already recorded this period. */
  usedTokens: number;
  /** Tokens the caller asked to project on top of what is recorded. */
  projectedTokens: number;
  monthlyAllowance: number;
  /** Share of the allowance consumed once the projection lands; zero without an allowance. */
  allowanceUsed: number;
  overAllowance: boolean;
  /** Estimated spend from the admin-maintained rates. Undefined when no rate is set. */
  estimatedCost?: number;
  /** Models with recorded usage and no rate, so the interface can say the estimate is incomplete. */
  unpricedModels: ModelId[];
  capacity: Capacity;
}
