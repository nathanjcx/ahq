import { mutate, query } from '../../../lib/server/backend';
import { safeError } from '../../../lib/server/secrets';
import { untrustedJson } from '../../../lib/server/untrusted';
import type { Job } from '../../types';
import type { WorkerRuntime } from '../state';
import { payload, runTurn, taskContext } from './context';

interface TriageAuthority {
  attended: boolean;
  allowList: string[];
  emergencyAllowList: string[];
  unattendedAttempts: number;
  emergency: boolean;
}

/**
 * One turn against one open incident.
 *
 * The allow-lists are the gateway's business, not the prompt's: the turn is told what it may do in
 * plain words, and `astra_triage` decides per call whether a write is admitted. Paging is the
 * scheduler's business — it sends the attempts the emergency rule counts, on its own interval — so
 * what this adds is the state of that ledger, and the run close that will not let an emergency
 * action leave without its incident report.
 */
export async function triageRun(runtime: WorkerRuntime, job: Job) {
  const input = payload(job);
  const context = await taskContext(job.taskId);
  const authority = await query<TriageAuthority>('services/triage:authority', {
    runToken: context.runToken,
  });
  try {
    await runTurn(runtime, job, context, {
      ...(input.model ? { model: input.model } : {}),
      sections: [
        {
          heading: 'Incident',
          lines: [
            `- Reason this run was scheduled: ${input.reason ?? 'an alert is open'}`,
            `- A person is ${authority.attended ? 'expected to be watching' : 'not expected to be watching'}.`,
            `- Pages delivered and unanswered on this incident: ${authority.unattendedAttempts}`,
            authority.emergency
              ? '- Nobody answered, so the emergency allow-list is open. Anything you do under it needs file_incident_report before this run ends.'
              : '- The emergency allow-list is shut. Merging and deploying need a person.',
          ],
        },
      ],
      brief: [
        'The incident',
        untrustedJson({ title: context.task.title, brief: context.task.prompt }),
        'Reproduce it first and post what you found with report_reproduction, so the affected floors know what they are working around. Then fix it as a pull request. Tools on the workspace’s triage allow-list execute without a proposal; anything else returns a proposal a person decides, and a proposal is not a completed action. Merging and deploying need a person unless the emergency allow-list is open.',
        'When the fix is in and verified, call resolve_alert with the cause, the fix, the prevention, and the regression test that would catch it again. If you used the emergency allow-list, call file_incident_report as well, in the same run. If you cannot get further without a person, say exactly what you need and stop.',
      ],
    });
  } finally {
    // Whether the turn finished or failed, an emergency action owes a report; this is where the
    // platform files the gap in its place and escalates it. A failure here is logged rather than
    // thrown, so it cannot replace the reason the turn itself stopped.
    await mutate('services/triage:closeRun', { taskId: job.taskId }).catch((error: unknown) =>
      console.error(`triage run close failed reason=${safeError(error)}`),
    );
  }
}
