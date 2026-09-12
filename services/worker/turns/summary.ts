import { mutate, query } from '../../../lib/server/backend';
import { safeError } from '../../../lib/server/secrets';
import { untrustedBlock } from '../../../lib/server/untrusted';
import type { Job, TaskContext } from '../../types';
import type { WorkerRuntime } from '../state';
import { runTurn } from './context';

interface FinishedTask {
  artifacts: { id: string; name: string }[];
  finalMessage?: string;
  hasSummary: boolean;
}

/**
 * One bounded wrap-up turn when a work task reaches a terminal state.
 *
 * A task summary is what later shifts on the same floor read, so it is worth one turn to have the
 * employee write it while the work is still in its session. When the turn does not file one — it
 * failed, it ran out of time, or the task itself failed — the summary is inferred from the final
 * message and marked inferred, exactly as a missing shift report is.
 */
export async function taskSummary(runtime: WorkerRuntime, job: Job, context: TaskContext) {
  if (context.task.kind !== 'work') return;
  const finished = await query<FinishedTask>('services/memory:summaryInputs', {
    taskId: context.task.id,
  });
  if (finished.hasSummary) return;
  try {
    await runTurn(runtime, job, context, {
      servers: ['shift'],
      brief: [
        'This task is finished. Close it with submit_summary on astra_shift: the outcome in one sentence, the decisions taken, what is still open, the ids of the deliverables it archived, and the summary a later shift would want to read. Claim nothing you did not do.',
        'What it archived',
        untrustedBlock(JSON.stringify(finished.artifacts)),
      ],
    });
  } catch (error) {
    console.error('Task summary turn failed:', safeError(error));
  }
  const current = await query<FinishedTask>('services/memory:summaryInputs', { taskId: context.task.id });
  if (current.hasSummary) return;
  // Nothing was filed, so the record still gets a summary — marked as the inference it is.
  await mutate('services/memory:recordSummary', {
    taskId: context.task.id,
    outcome: (finished.finalMessage ?? context.task.title).slice(0, 400),
    decisions: [],
    openQuestions: [],
    artifactIds: finished.artifacts.map((artifact) => artifact.id),
    text: finished.finalMessage ?? '',
    inferred: true,
  });
}
