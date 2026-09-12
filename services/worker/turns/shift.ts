import { mutate, query } from '../../../lib/server/backend';
import { untrustedBlock } from '../../../lib/server/untrusted';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { payload, runTurn, taskContext } from './context';

interface OpenFinding {
  id: string;
  severity: string;
  /** Already fenced by `services/audit:openFindingsFor`; it is another agent's words. */
  prompt: string;
}

/** The findings that lead the day, delivered first thing so the shift opens with them. */
async function findingSection(employeeId: string | undefined, findingIds: string[]) {
  if (!employeeId || !findingIds.length) return undefined;
  const open = await query<OpenFinding[]>('services/audit:openFindingsFor', { employeeId });
  const leading = open.filter((finding) => findingIds.includes(finding.id));
  if (!leading.length) return undefined;
  return {
    heading: 'Open findings (clear these before any other work)',
    lines: leading.map((finding) => `- [${finding.severity}] ${finding.id}\n${finding.prompt}`),
  };
}

/**
 * One working day of a daily task.
 *
 * The shift row opens first, so the office and the planner see the instance working before the model
 * does anything. The turn is asked to end with `submit_report`; when it does not, the shift is closed
 * without one and the platform infers the report from the journal and marks it inferred, which is
 * what the missing-report path is for.
 */
export async function startShift(runtime: WorkerRuntime, job: Job) {
  const input = payload(job);
  const context = await taskContext(job.taskId);
  const { shiftId, date } = await mutate<{ shiftId: string; date: string }>('services/schedule:startShift', {
    taskId: job.taskId,
    leaseToken: job.leaseToken,
    model: input.model ?? context.task.model,
    kind: 'work',
  });
  const findings = await findingSection(input.employeeId, input.findingIds ?? []);
  await runTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    sections: findings ? [findings] : [],
    brief: [
      `Shift ${date}: continue the task; end with a report.`,
      'Task',
      untrustedBlock(context.task.prompt),
      findings
        ? 'Clear the open findings above before anything else, and name each finding id in the report line that addresses it.'
        : '',
      'Before the shift ends, call submit_report on astra_shift exactly once with what you finished, what is in progress, what blocks you, what comes next, the risks, and your confidence in the deadline from 0 to 1.',
    ],
  });
  // A turn that ended without filing one still ends its shift; the report is inferred and marked.
  await mutate('services/schedule:endShift', { shiftId });
  // A finding the shift led with is addressed once that shift ends; the next audit verifies it.
  for (const findingId of input.findingIds ?? []) await mutate('services/audit:markAddressed', { findingId });
  return { shiftId, date };
}
