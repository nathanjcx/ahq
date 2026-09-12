import type { Job, JobKind } from '../../types';
import type { WorkerRuntime } from '../state';
import { emailClassify } from './classify';
import { meetingAnswer, meetingPrep, meetingWrapup } from './meeting';
import { pageAlert } from './page';
import { planProject } from './plan';
import { curationRun, auditRun } from './reserved';
import { reviewShift } from './review';
import { startShift } from './shift';
import { triageRun } from './triage';

type TurnHandler = (runtime: WorkerRuntime, job: Job) => Promise<unknown>;

/**
 * The job kinds the worker dispatches off the queue by itself: every turn, plus the page an incident
 * sends, which runs no model but needs the notification transports. Everything else — the first
 * message of a task, a follow-up message, a cancellation, an approved external write — stays in
 * `services/worker/jobs.ts`.
 */
const TURNS: Partial<Record<JobKind, TurnHandler>> = {
  start_shift: startShift,
  review_shift: reviewShift,
  meeting_prep: meetingPrep,
  meeting_answer: meetingAnswer,
  meeting_wrapup: meetingWrapup,
  curation_run: curationRun,
  audit_run: auditRun,
  triage_run: triageRun,
  page_alert: pageAlert,
  email_classify: emailClassify,
  plan_project: planProject,
};

export function turnFor(kind: JobKind): TurnHandler | undefined {
  return TURNS[kind];
}

export { installTurnRunner, turnRunner, type TurnRequest, type TurnResult, type TurnRunner } from './runner';
