import { mutate, query } from '../../../lib/server/backend';
import { deliverNotifications, type NotificationAttempt } from '../../../lib/server/notify';
import { untrustedJson } from '../../../lib/server/untrusted';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { payload, runTurn, taskContext } from './context';

interface TriageAuthority {
  attended: boolean;
  allowList: string[];
  emergencyAllowList: string[];
  unattendedAttempts: number;
}

/**
 * Pages a person and delivers the attempt.
 *
 * Only a delivered, unacknowledged attempt counts towards the emergency rule, so the attempt is
 * recorded, then delivered, and the count that opens the emergency allow-list is read back from the
 * ledger rather than from anything this function believes it sent.
 */
export async function notifyPerson(
  workspaceId: string,
  input: { title: string; text: string; alertId?: string },
) {
  const attempts = await mutate<NotificationAttempt[]>('services/notifications:attempt', {
    workspaceId,
    kind: 'triage',
    title: input.title,
    text: input.text,
    ...(input.alertId ? { alertId: input.alertId } : {}),
  });
  return deliverNotifications(attempts);
}

/**
 * One turn against one open incident.
 *
 * The allow-lists are the gateway's business, not the prompt's: the turn is told what it may do in
 * plain words, and `astra_triage` decides per call whether a write is admitted. What the worker does
 * here is page a person when the turn needs one, because the emergency rule counts pages that were
 * delivered and went unanswered, and nothing gets delivered unless somebody sends it.
 */
export async function triageRun(runtime: WorkerRuntime, job: Job) {
  const input = payload(job);
  const context = await taskContext(job.taskId);
  const authority = await query<TriageAuthority>('services/triage:authority', {
    runToken: context.runToken,
  });
  if (!authority.attended && authority.unattendedAttempts === 0 && input.alertId)
    await notifyPerson(context.task.workspaceId, {
      title: `Incident needs a person: ${context.task.title}`,
      text: 'An incident is open outside attended hours and needs approval to go further.',
      alertId: input.alertId,
    });
  await runTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    sections: [
      {
        heading: 'Incident',
        lines: [
          `- Reason this run was scheduled: ${input.reason ?? 'an alert is open'}`,
          `- A person is ${authority.attended ? 'expected to be watching' : 'not expected to be watching'}.`,
          `- Pages delivered and unanswered in the last twenty minutes: ${authority.unattendedAttempts}`,
        ],
      },
    ],
    brief: [
      'The incident',
      untrustedJson({ title: context.task.title, brief: context.task.prompt }),
      'Reproduce it first and post what you found with report_reproduction, so the affected floors know what they are working around. Then fix it as a pull request. Tools on the workspace’s triage allow-list execute without a proposal; anything else returns a proposal a person decides, and a proposal is not a completed action. Merging and deploying need a person.',
      'When the fix is in and verified, call resolve_alert with the cause, the fix, the prevention, and the regression test that would catch it again. If you cannot get further without a person, say exactly what you need and stop.',
    ],
  });
}
