import { mutate, query } from '../../lib/server/backend';
import { sessionConfiguration } from '../../lib/server/agents';
import { safeError } from '../../lib/server/secrets';
import { executeAction } from '../actions';
import { initialTaskInput } from '../task-input';
import type { Job, TaskContext } from '../types';
import type { WorkerRuntime } from './state';

const leaseRenewalMs = 20_000;
const recoveryScanLimit = 200;

/**
 * Session creation has no idempotency key, and the sessions API cannot filter by metadata
 * (`SessionListParams` carries `agent_id` and `order` only). Recovery is therefore a bounded
 * newest-first scan that stops at the task's own creation time.
 */
async function recoverSession(runtime: WorkerRuntime, taskId: string, createdAt: number) {
  let scanned = 0;
  for await (const candidate of runtime.api.beta.agents.sessions.list({ order: 'desc' })) {
    if (++scanned > recoveryScanLimit || candidate.created_at * 1000 < createdAt) return undefined;
    if (candidate.metadata.ahq_task_id === taskId) return candidate.id;
  }
  return undefined;
}

async function sendInput(runtime: WorkerRuntime, job: Job) {
  const context = await query<TaskContext>('services/sessions:taskContext', { taskId: job.taskId });
  if (context.task.status === 'cancelled') {
    await mutate('services/queue:completeJob', { jobId: job.id, leaseToken: job.leaseToken });
    return;
  }
  let sessionId = context.task.sessionId;
  if (!sessionId) {
    if (job.attempts > 1) sessionId = await recoverSession(runtime, job.taskId, context.task.createdAt);
    if (!sessionId)
      sessionId = (await runtime.api.beta.agents.sessions.create(sessionConfiguration(context))).id;
    // Record the session before the first message, so a retry never creates a second one.
    await mutate('services/sessions:recordSession', {
      taskId: job.taskId,
      sessionId,
      leaseToken: job.leaseToken,
    });
  }
  await runtime.api.beta.agents.sessions.events.create(sessionId, {
    events: [
      {
        type: 'agent.session.input.message',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: job.kind === 'start_task' ? initialTaskInput(context) : String(job.payload.text || ''),
              },
            ],
          },
        ],
      },
    ],
    'Idempotency-Key': job.id,
  });
  await mutate('services/queue:completeJob', { jobId: job.id, leaseToken: job.leaseToken });
}

/** Runs one claimed job. The claim's lease token authorizes every mutation this makes. */
export async function runJob(runtime: WorkerRuntime, job: Job) {
  const heartbeat = setInterval(() => {
    void mutate('services/queue:renewLease', { jobId: job.id, leaseToken: job.leaseToken }).catch((error) =>
      console.error('Lease renewal failed:', safeError(error)),
    );
  }, leaseRenewalMs);
  try {
    if (job.kind === 'execute_action') {
      await executeAction(job);
    } else if (job.kind === 'cancel_task') {
      const sessionId = String(job.payload.sessionId || '');
      if (sessionId)
        await runtime.api.beta.agents.sessions.events.create(sessionId, {
          events: [{ type: 'agent.session.input.cancel' }],
          'Idempotency-Key': job.id,
        });
      runtime.monitors.get(job.taskId)?.abort();
      await mutate('services/queue:completeJob', { jobId: job.id, leaseToken: job.leaseToken });
    } else if (job.kind === 'start_task' || job.kind === 'send_message') {
      await sendInput(runtime, job);
    } else throw new Error(`Unsupported queue job: ${job.kind}`);
  } catch (error) {
    console.error('Job failed:', safeError(error));
    // A dispatched external write is never retried: its outcome is unknown, not failed.
    await mutate('services/queue:failJob', {
      jobId: job.id,
      leaseToken: job.leaseToken,
      error: safeError(error),
      retryable: job.kind !== 'execute_action',
      outcomeUnknown: job.kind === 'execute_action',
    }).catch((failure) => console.error('Failed to record job error:', safeError(failure)));
  } finally {
    clearInterval(heartbeat);
  }
}
