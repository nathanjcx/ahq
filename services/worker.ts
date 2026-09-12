import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { AgentSessionEvent, AgentSessionItem } from 'openai/resources/beta/agents/agents';
import { agentsClient, sessionConfiguration, sessionUsage } from '../lib/server/agents';
import { query, mutate } from '../lib/server/backend';
import { requiredEnv, safeError } from '../lib/server/secrets';
import { putArtifact } from '../lib/server/storage';
import { executeAction } from './actions';
import type { Job, TaskContext, SessionContext } from './types';
import { initialTaskInput } from './task-input';
const secret = requiredEnv('AHQ_SERVICE_SECRET'),
  workerId = randomUUID(),
  api = agentsClient();
const database = new ConvexClient(process.env.CONVEX_URL || requiredEnv('NEXT_PUBLIC_CONVEX_URL'));
const monitors = new Map<string, AbortController>();
let stopping = false,
  draining = false,
  wakeAgain = false,
  lastSubscription = 0;
function boundedSetting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return Math.max(min, Math.min(max, Math.floor(value)));
}
const concurrency = boundedSetting('WORKER_CONCURRENCY', 4, 1, 16);
const maxRuntime = boundedSetting('MAX_TURN_SECONDS', 900, 60, 3600) * 1000;
interface JournalEvent {
  externalId: string;
  type: string;
  text: string;
  createdAt: number;
  gap?: boolean;
}
interface JournalMessage {
  externalId: string;
  role: 'assistant';
  text: string;
  createdAt: number;
  phase?: string;
  completed?: boolean;
}
async function journal(taskId: string, event: JournalEvent) {
  await mutate('services/sessions:recordEvents', { taskId, events: [event] });
}
async function archiveFiles(context: SessionContext) {
  if (!context.task.sessionId) return;
  const archived = new Set(context.archivedStorageKeys || []);
  let count = 0;
  for await (const artifact of api.beta.agents.sessions.artifacts.list(context.task.sessionId)) {
    if (++count > 100) {
      await journal(context.task.id, {
        externalId: 'artifact-count-limit',
        type: 'artifact.unavailable',
        text: 'This task reached the 100-file archive limit. Keep additional deliverables in a new task.',
        createdAt: Date.now(),
      });
      break;
    }
    const storageKey = `${context.task.workspaceId}/${context.task.id}/${artifact.id}`;
    if (archived.has(storageKey)) continue;
    if (artifact.size_bytes > 25_000_000) {
      await journal(context.task.id, {
        externalId: `artifact-limit:${artifact.id}`,
        type: 'artifact.unavailable',
        text: 'A file exceeds the 25 MB archive limit. Ask the employee to split it.',
        createdAt: Date.now(),
      });
      continue;
    }
    const response = await api.beta.agents.sessions.artifacts.content(artifact.id, {
      session_id: context.task.sessionId,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 25_000_000) throw new Error('Artifact exceeded archive size limit');
    await putArtifact(storageKey, bytes, 'application/octet-stream');
    await mutate('services/artifacts:recordArtifact', {
      taskId: context.task.id,
      name: artifact.path.split('/').pop() || 'file',
      mediaType: 'application/octet-stream',
      size: bytes.byteLength,
      storageKey,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
}
function itemMessage(item: AgentSessionItem): JournalMessage | undefined {
  if (item.type !== 'message' || item.role !== 'assistant' || !item.id) return;
  return {
    externalId: item.id,
    role: 'assistant',
    completed: item.status === 'completed',
    text: item.content.flatMap((part) => ('text' in part ? [part.text] : [])).join('\n'),
    createdAt: Date.now(),
    ...(item.phase ? { phase: item.phase } : {}),
  };
}
async function monitor(taskId: string, controller: AbortController) {
  let reconnect = 0;
  while (!stopping && !controller.signal.aborted) {
    const context = await query<SessionContext>('services/sessions:sessionContext', { taskId });
    if (
      context.pendingInput ||
      !context.task.sessionId ||
      ['completed', 'failed', 'cancelled', 'uncertain'].includes(context.task.status)
    )
      return;
    const sessionId = context.task.sessionId;
    let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
    let timer: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
    let events: JournalEvent[] = [],
      messages = new Map<string, JournalMessage>();
    const completed = new Set<string>(),
      recoveredPartial = new Set<string>(),
      parts = new Map<string, Map<number, string>>();
    let flushChain = Promise.resolve();
    const flush = () => {
      if (!events.length && !messages.size) return flushChain;
      const batch = { taskId, events: events.splice(0), messages: [...messages.values()] };
      messages.clear();
      flushChain = flushChain.then(() => mutate('services/sessions:recordEvents', batch)).then(() => {});
      return flushChain;
    };
    try {
      // Subscribe first. The SDK buffers live events while saved items are reconciled.
      stream = await api.beta.agents.sessions.events.stream(sessionId, { signal: controller.signal });
      const session = await api.beta.agents.sessions.retrieve(sessionId, { signal: controller.signal });
      for await (const item of api.beta.agents.sessions.items.list(
        sessionId,
        { order: 'asc' },
        { signal: controller.signal },
      )) {
        const message = itemMessage(item);
        if (message) {
          messages.set(message.externalId, message);
          if (item.type === 'message' && item.status === 'completed') completed.add(message.externalId);
          else recoveredPartial.add(message.externalId);
        }
        if (messages.size >= 50) await flush();
      }
      if (reconnect || context.task.status !== 'queued')
        events.push({
          externalId: `recovery:${randomUUID()}`,
          type: 'stream.reconciled',
          text: 'Recovered saved session items. Intermediate events missed during disconnection cannot be replayed by the provider.',
          createdAt: Date.now(),
          gap: true,
        });
      const latest = await api.beta.agents.sessions.turns.list(
        sessionId,
        { order: 'desc', limit: 1 },
        { signal: controller.signal },
      );
      const turn = latest.data[0];
      // An idle session with no turn is still waiting for its first message.
      if (
        session.status === 'failed' ||
        (session.status === 'idle' && turn && ['completed', 'failed', 'cancelled'].includes(turn.status))
      ) {
        await flush();
        if (turn?.status === 'completed') await archiveFiles(context);
        await mutate('services/sessions:recordEvents', {
          taskId,
          events: [],
          inputRevision: context.inputRevision,
          status: session.status === 'failed' ? 'failed' : turn.status,
          ...(session.usage ? { usage: sessionUsage(session.usage) } : {}),
        });
        return;
      }
      const started = turn?.started_at ? turn.started_at * 1000 : Date.now();
      deadline = setTimeout(
        () => {
          void (async () => {
            const update = await mutate<{ status: string }>('services/sessions:recordEvents', {
              taskId,
              inputRevision: context.inputRevision,
              events: [
                {
                  externalId: `timeout:${turn?.id || sessionId}`,
                  type: 'task.timeout',
                  text: 'The configured run time limit was reached. Cancellation was requested.',
                  createdAt: Date.now(),
                },
              ],
              status: 'cancelled',
            });
            if (update.status !== 'cancelled') {
              controller.abort();
              return;
            }
            try {
              await api.beta.agents.sessions.events.create(sessionId, {
                events: [{ type: 'agent.session.input.cancel' }],
                'Idempotency-Key': `timeout:${turn?.id || sessionId}`,
              });
            } catch {
              await journal(taskId, {
                externalId: `timeout-unknown:${turn?.id || sessionId}`,
                type: 'task.cancellation_unknown',
                text: 'Provider cancellation could not be confirmed. External tools are blocked; check the OpenAI session.',
                createdAt: Date.now(),
              });
            }
            controller.abort();
          })().catch((error) => console.error('Run limit enforcement failed:', safeError(error)));
        },
        Math.max(1, maxRuntime - (Date.now() - started)),
      );
      await flush();
      timer = setInterval(() => {
        void flush().catch(() => controller.abort());
      }, 150);
      for await (const event of stream) {
        const now = Date.now();
        if (
          event.type === 'agent.session.turn.output_text.delta' ||
          event.type === 'agent.session.turn.output_text.done'
        ) {
          if (
            !completed.has(event.item_id) &&
            !(event.type === 'agent.session.turn.output_text.delta' && recoveredPartial.has(event.item_id))
          ) {
            const content = parts.get(event.item_id) || new Map<number, string>();
            content.set(
              event.content_index,
              event.type.endsWith('.delta')
                ? (content.get(event.content_index) || '') + ('delta' in event ? event.delta : '')
                : 'text' in event
                  ? event.text
                  : '',
            );
            parts.set(event.item_id, content);
            messages.set(event.item_id, {
              externalId: event.item_id,
              role: 'assistant',
              text: [...content.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, text]) => text)
                .join('\n'),
              createdAt: now,
              phase: 'commentary',
            });
          }
        } else if (event.type === 'agent.session.turn.item.done') {
          const message = itemMessage(event.item as AgentSessionItem);
          if (message) {
            messages.set(message.externalId, message);
            completed.add(message.externalId);
            parts.delete(message.externalId);
          }
        }
        const descriptions: Partial<Record<AgentSessionEvent['type'], string>> = {
          'agent.session.environment.ready': 'Employee environment is ready.',
          'agent.session.turn.created': 'Employee started a turn.',
          'agent.session.turn.completed': 'Employee finished this turn.',
          'agent.session.turn.failed': 'The turn failed.',
          'agent.session.turn.cancelled': 'The turn was cancelled.',
          'agent.session.requires_action': 'The session needs external input.',
          'agent.session.failed': 'The session failed.',
        };
        const description = descriptions[event.type];
        if (description)
          events.push({ externalId: event.event_id, type: event.type, text: description, createdAt: now });
        if (events.length >= 40) await flush();
        if (
          [
            'agent.session.turn.completed',
            'agent.session.turn.failed',
            'agent.session.turn.cancelled',
            'agent.session.failed',
          ].includes(event.type)
        ) {
          await flush();
          const current = await api.beta.agents.sessions.retrieve(sessionId);
          if (event.type === 'agent.session.turn.completed') await archiveFiles(context);
          await mutate('services/sessions:recordEvents', {
            taskId,
            events: [],
            inputRevision: context.inputRevision,
            status: event.type.endsWith('completed')
              ? 'completed'
              : event.type.endsWith('cancelled')
                ? 'cancelled'
                : 'failed',
            ...(current.usage ? { usage: sessionUsage(current.usage) } : {}),
          });
          return;
        }
      }
      throw new Error('Session event stream disconnected');
    } catch (error) {
      if (controller.signal.aborted || stopping) return;
      console.error('Session stream interrupted:', safeError(error));
      await journal(taskId, {
        externalId: `disconnect:${randomUUID()}`,
        type: 'stream.disconnected',
        text: 'Connection interrupted. Reconnecting and recovering saved output.',
        createdAt: Date.now(),
        gap: true,
      });
      await delay(Math.min(30_000, 1000 * 2 ** Math.min(reconnect++, 5)), undefined, {
        signal: controller.signal,
      }).catch(() => {});
    } finally {
      if (timer) clearInterval(timer);
      if (deadline) clearTimeout(deadline);
      stream?.controller.abort();
      await flush().catch((error) => console.error('Journal failed:', safeError(error)));
    }
  }
}
function startMonitor(taskId: string) {
  if (monitors.has(taskId) || stopping) return;
  const controller = new AbortController();
  monitors.set(taskId, controller);
  let heartbeat: NodeJS.Timeout | undefined;
  const claim = async () => {
    const lease = await mutate<{ claimed: boolean }>('services/queue:claimStream', { taskId, workerId });
    if (!lease.claimed) controller.abort();
    return lease.claimed;
  };
  void claim()
    .then(async (claimed) => {
      if (!claimed) return;
      heartbeat = setInterval(() => {
        void claim().catch(() => controller.abort());
      }, 40_000);
      await monitor(taskId, controller);
    })
    .catch((error) => console.error('Monitor stopped:', safeError(error)))
    .finally(() => {
      if (heartbeat) clearInterval(heartbeat);
      monitors.delete(taskId);
      if (!stopping && !controller.signal.aborted)
        setTimeout(() => {
          void query<SessionContext>('services/sessions:sessionContext', { taskId })
            .then((context) => {
              if (
                !context.pendingInput &&
                (context.task.status === 'running' || context.task.status === 'queued')
              )
                startMonitor(taskId);
            })
            .catch(() => {});
        }, 1000);
    });
}
async function run(job: Job) {
  const heartbeat = setInterval(() => {
    void mutate('services/queue:renewLease', { jobId: job.id, leaseToken: job.leaseToken }).catch((error) =>
      console.error('Lease renewal failed:', safeError(error)),
    );
  }, 20_000);
  try {
    if (job.kind === 'execute_action') {
      await executeAction(job);
      return;
    }
    if (job.kind === 'cancel_task') {
      const sessionId = String(job.payload.sessionId || '');
      if (sessionId)
        await api.beta.agents.sessions.events.create(sessionId, {
          events: [{ type: 'agent.session.input.cancel' }],
          'Idempotency-Key': job.id,
        });
      monitors.get(job.taskId)?.abort();
    } else if (job.kind === 'start_task' || job.kind === 'send_message') {
      const context = await query<TaskContext>('services/sessions:taskContext', { taskId: job.taskId });
      if (context.task.status === 'cancelled') {
        await mutate('services/queue:completeJob', { jobId: job.id, leaseToken: job.leaseToken });
        return;
      }
      let sessionId = context.task.sessionId;
      if (!sessionId) {
        // Session creation has no documented idempotency key. Recover by metadata on retry.
        if (job.attempts > 1) {
          for await (const candidate of api.beta.agents.sessions.list()) {
            if (candidate.metadata.ahq_task_id === job.taskId) {
              sessionId = candidate.id;
              break;
            }
          }
        }
        if (!sessionId) {
          const session = await api.beta.agents.sessions.create(sessionConfiguration(context));
          sessionId = session.id;
        }
        await mutate('services/sessions:recordSession', {
          taskId: job.taskId,
          sessionId,
          leaseToken: job.leaseToken,
        });
      }
      await api.beta.agents.sessions.events.create(sessionId, {
        events: [
          {
            type: 'agent.session.input.message',
            input: [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text:
                      job.kind === 'start_task' ? initialTaskInput(context) : String(job.payload.text || ''),
                  },
                ],
              },
            ],
          },
        ],
        'Idempotency-Key': job.id,
      });
      await mutate('services/queue:completeJob', { jobId: job.id, leaseToken: job.leaseToken });
      startMonitor(job.taskId);
      return;
    } else throw new Error(`Unsupported queue job: ${job.kind}`);
    await mutate('services/queue:completeJob', { jobId: job.id, leaseToken: job.leaseToken });
  } catch (error) {
    console.error('Job failed:', safeError(error));
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
async function drain() {
  if (draining) {
    wakeAgain = true;
    return;
  }
  draining = true;
  try {
    do {
      wakeAgain = false;
      const jobs = await mutate<Job[]>('services/queue:claimJobs', { workerId, limit: concurrency });
      if (!jobs.length) break;
      await Promise.all(jobs.map(run));
      wakeAgain = true;
    } while (wakeAgain && !stopping);
  } catch (error) {
    console.error('Queue connection failed:', safeError(error));
    setTimeout(() => void drain(), 5000);
  } finally {
    draining = false;
  }
}
const unsubscribe = database.onUpdate(
  makeFunctionReference<'query'>('services/queue:workerState'),
  { secret },
  (state: { pendingJobs: number; activeTaskIds: string[] }) => {
    lastSubscription = Date.now();
    for (const taskId of state.activeTaskIds) startMonitor(taskId);
    if (state.pendingJobs) void drain();
  },
  (error) => console.error('Queue subscription failed:', safeError(error)),
);
const health = createServer((_req, res) => {
  const connected = lastSubscription > 0 && database.connectionState().isWebSocketConnected && !stopping;
  res.writeHead(connected ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: connected ? 'ok' : 'connecting',
      service: 'worker',
      activeSessions: monitors.size,
    }),
  );
}).listen(Number(process.env.PORT || 4002), '0.0.0.0');
async function shutdown() {
  stopping = true;
  unsubscribe();
  for (const controller of monitors.values()) controller.abort();
  health.close();
  await database.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
