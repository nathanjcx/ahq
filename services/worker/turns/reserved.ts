import { query } from '../../../lib/server/backend';
import { untrustedJson } from '../../../lib/server/untrusted';
import { GatewayError } from '../../gateway/errors';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { payload, runBareTurn, taskContext } from './context';

function requireWorkspace(job: Job) {
  const input = payload(job);
  if (!input.workspaceId)
    throw new GatewayError('invalid_arguments', 'This run needs the workspace it belongs to.');
  return { ...input, workspaceId: input.workspaceId };
}

/**
 * The janitor's curation run, bounded to one turn.
 *
 * Its inputs are the whole workspace's memory, so the turn is not given a working-memory block of
 * its own: `read_memory` on `astra_janitor` is the same view, and injecting it twice would spend the
 * budget describing what the tools already return.
 */
export async function curationRun(runtime: WorkerRuntime, job: Job) {
  const input = requireWorkspace(job);
  const context = await taskContext(job.taskId);
  const inputs = await query<Record<string, unknown>>('services/memory:curateInputs', {
    runToken: context.runToken,
    workspaceId: input.workspaceId,
  });
  const { budgets, scopes, entries } = inputs;
  await runBareTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    brief: [
      'Curation run. Work through the claims waiting on a decision and leave the workspace’s memory smaller and truer than you found it. Merge claims that say the same thing, contest claims that conflict — naming the claim they conflict with — archive what is stale or wrong, and promote only what the whole workspace needs. Never invent a claim, and never decide a conflict yourself: a contested claim waits for a person.',
      `Budgets per scope: ${JSON.stringify(budgets)}`,
      `Fill against those budgets: ${JSON.stringify(scopes)}`,
      'The claims, waiting ones first',
      untrustedJson(entries),
      'Use the astra_janitor tools. This is one turn: do the work, then say in one paragraph what you changed and why.',
    ],
  });
}

/**
 * The nightly audit pass. Findings are filed through `submit_findings`, which also re-verifies
 * yesterday's, so a finding that was addressed and shows it in the record closes the same night.
 */
export async function auditRun(runtime: WorkerRuntime, job: Job) {
  const input = requireWorkspace(job);
  if (!input.date) throw new GatewayError('invalid_arguments', 'An audit run needs the day it audits.');
  const context = await taskContext(job.taskId);
  await runBareTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    brief: [
      `Audit the working day ${input.date}.`,
      'Start with read_reports for that date. For every shift, check the report’s claims against read_journal for its task: work claimed that the journal does not show, data that appears from nowhere, tests that failed or were never run, code and copy against the workspace standard, and whether yesterday’s findings were actually addressed. Read an archived deliverable with read_artifact when the journal alone cannot settle it.',
      'A finding is a claim you can point at evidence for. Quote the evidence; do not paraphrase it into something stronger. Where the record is simply thin, say so and do not file a finding.',
      `Finish by calling submit_findings once with date "${input.date}" and every finding you are prepared to defend, each naming the employee it is against, the task where relevant, its severity, the claim, the evidence, and the action it requires. File it even when the list is empty.`,
    ],
  });
}
