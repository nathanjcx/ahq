import type { ModelId, TokenUsage } from './core';

export type Cadence = 'once' | 'daily';
export type OvernightPolicy = 'off' | 'audits_only' | 'cheap';
export type ShiftKind = 'work' | 'review' | 'prep' | 'wrapup';
export type EmployeeKind = 'worker' | 'janitor' | 'auditor' | 'triage';

export interface Shift {
  id: string;
  taskId: string;
  employeeId: string;
  date: string;
  model: ModelId;
  kind: ShiftKind;
  startedAt: number;
  endedAt?: number;
  reportId?: string;
}
export interface Report {
  id: string;
  taskId: string;
  employeeId: string;
  shiftId?: string;
  done: string[];
  inProgress: string[];
  blockedOn: string[];
  next: string[];
  risks: string[];
  deadlineConfidence?: number;
  inferred: boolean;
  createdAt: number;
}
export type Pacing = 'ahead' | 'on_track' | 'behind' | 'unknown';
export interface WorkingHours {
  timezone: string;
  workingDays: number[];
  startHour: number;
  endHour: number;
  attendedStartHour: number;
  attendedEndHour: number;
  overnightPolicy: OvernightPolicy;
}
export interface ScheduleSummary extends WorkingHours {
  /** Whether the workspace is inside working hours and attended hours right now. */
  working: boolean;
  attended: boolean;
  usageToday: TokenUsage & { cap: number };
}
