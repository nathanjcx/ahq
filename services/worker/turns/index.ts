import type { Job, JobKind } from '../../types';
import type { WorkerRuntime } from '../state';
import { emailClassify } from './classify';
import { meetingAnswer, meetingPrep, meetingWrapup } from './meeting';
import { planProject } from './plan';
import { curationRun, auditRun } from './reserved';
import { reviewShift } from './review';
import { startShift } from './shift';
import { triageRun } from './triage';

type TurnHandler = (runtime: WorkerRuntime, job: Job) => Promise<unknown>;

/**
 * The job kinds that run a turn. Everything else on the queue — the first message of a task, a
 * follow-up message, a cancellation, an approved external write — is not a turn and stays in
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
  email_classify: emailClassify,
  plan_project: planProject,
};

export function turnFor(kind: JobKind): TurnHandler | undefined {
  return TURNS[kind];
}

export { installTurnRunner, turnRunner, type TurnRequest, type TurnResult, type TurnRunner } from './runner';
