import type { Severity } from './audit';

export type AlertSource = 'github' | 'webhook' | 'email' | 'manual';
export type AlertStatus = 'open' | 'triaging' | 'fixed' | 'closed' | 'dismissed';

/**
 * How far the emergency rule has run on one alert: delivered pages nobody has answered since the
 * first of them, and when the emergency allow-list opens if nobody answers.
 */
export interface AlertPaging {
  attempts: number;
  required: number;
  firstAttemptAt?: number;
  lastAttemptAt?: number;
  opensAt?: number;
  /** Answered, and nothing has paged since. An acknowledgement resets the rule. */
  acknowledged: boolean;
  /** When the scheduler sends the next page, while fewer than `required` have been delivered. */
  nextAttemptAt?: number;
}
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
  paging: AlertPaging;
  createdAt: number;
  updatedAt: number;
}
/** One step in an alert's history, from the delivery that opened it to the report that closed it. */
export interface TriageEvent {
  id: string;
  at: number;
  kind: 'intake' | 'run' | 'tool' | 'page' | 'post';
  title: string;
  detail?: string;
  /** For a provider call: whether the workspace's ordinary allow-list admitted it, or the emergency one. */
  authority?: 'allow_list' | 'emergency';
  outcome?: string;
  taskId?: string;
  postId?: string;
}
/** A post-mortem, or the report the emergency rule requires when triage acted without permission. */
export interface IncidentReport {
  id: string;
  alertId?: string;
  alertTitle?: string;
  severity?: Severity;
  authorName: string;
  text: string;
  taskId?: string;
  emergency: boolean;
  /** The platform filed this placeholder because the run used emergency authority and wrote no report. */
  missing?: boolean;
  createdAt: number;
}
/** How alerts reach this workspace. The signing secret is never read back, only whether one is set. */
export interface TriageIntake {
  signedEndpointReady: boolean;
  /** When the signing secret was last written. The secret itself is never read back. */
  secretUpdatedAt?: number;
  rules: string[];
  github: string[];
  emailClassification: boolean;
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
