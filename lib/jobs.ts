/**
 * The queue kinds the worker runs, in one place.
 *
 * The planner (`convex/lib/schedule.ts`) enqueues a subset of these and the worker dispatches all of
 * them, so both sides type themselves from this list rather than repeating it. Nothing here imports
 * Convex or Node, so either side can read it.
 */
export const JOB_KINDS = [
  'start_task',
  'send_message',
  'cancel_task',
  'execute_action',
  'start_shift',
  'review_shift',
  'meeting_prep',
  'meeting_answer',
  'meeting_wrapup',
  'curation_run',
  'audit_run',
  'triage_run',
  'page_alert',
  'email_classify',
  'plan_project',
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export function isJobKind(value: string): value is JobKind {
  return (JOB_KINDS as readonly string[]).includes(value);
}
