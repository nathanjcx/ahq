import type { Severity } from './audit';

export type AlertSource = 'github' | 'webhook' | 'email' | 'manual';
export type AlertStatus = 'open' | 'triaging' | 'fixed' | 'closed' | 'dismissed';

export interface Alert {
  id: string;
  source: AlertSource;
  fingerprint: string;
  severity: Severity;
  title: string;
  detail: string;
  url?: string;
  status: AlertStatus;
  triageTaskId?: string;
  affectedFloorIds: string[];
  occurrences: number;
  createdAt: number;
  updatedAt: number;
}
export interface Notification {
  id: string;
  kind: 'triage' | 'meeting' | 'finding' | 'general';
  title: string;
  text: string;
  alertId?: string;
  attempt: number;
  sentAt: number;
  acknowledgedAt?: number;
}
