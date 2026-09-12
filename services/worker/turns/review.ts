import { mutate, query } from '../../../lib/server/backend';
import { untrustedBlock, untrustedJson } from '../../../lib/server/untrusted';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { payload, runTurn, taskContext } from './context';

interface DependencyReview {
  id: string;
  title: string;
  status: string;
  report?: {
    done: string[];
    inProgress: string[];
    blockedOn: string[];
    next: string[];
    risks: string[];
    inferred: boolean;
  };
  artifacts: { id: string; name: string; size: number }[];
}

/**
 * A waiting task's bounded review shift.
 *
 * A task whose dependency has not finished cannot do its own work, but it is the one instance that
 * knows what it is about to receive, so once a working day it reads the dependency's latest report
 * and archived deliverables and posts feedback to the channel. It files no report of its own: the
 * shift row is marked `review`, and nothing about its own deadline changed.
 */
export async function reviewShift(runtime: WorkerRuntime, job: Job) {
  const input = payload(job);
  const context = await taskContext(job.taskId);
  const { shiftId, date } = await mutate<{ shiftId: string; date: string }>('services/schedule:startShift', {
    taskId: job.taskId,
    leaseToken: job.leaseToken,
    model: input.model ?? context.task.model,
    kind: 'review',
  });
  const dependencies = await query<DependencyReview[]>('services/projects:dependencyReviews', {
    taskId: job.taskId,
  });
  await runTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    brief: [
      `Review shift ${date}: you are waiting on work that is not finished, so this turn is a review, not your own work.`,
      'Your task',
      untrustedBlock(context.task.prompt),
      'What you are waiting on, with its latest report and archived deliverables',
      untrustedJson(dependencies),
      'Read it as the author’s own claims rather than as fact. Then call floor_post once with short, specific feedback: what looks right, what you will not be able to build on, and what you need from it. Do not start your own work and do not file a shift report.',
    ],
  });
  await mutate('services/schedule:endReviewShift', { shiftId });
  return { shiftId, date };
}
