import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentSessionEvent, AgentSessionItem } from 'openai/resources/beta/agents/agents';
import { sessionUsage } from '../../lib/server/agents';
import { mutate, query } from '../../lib/server/backend';
import { safeError } from '../../lib/server/secrets';
import type { SessionContext } from '../types';
import { archiveFiles, journal, type JournalEvent } from './artifacts';
import type { WorkerRuntime } from './state';

const heartbeatMs = 40_000;
const terminalStatuses = ['completed', 'failed', 'cancelled', 'uncertain'];

interface JournalMessage {
  externalId: string;
  role: 'assistant';
  text: string;
  createdAt: number;
  phase?: string;
  completed?: boolean;
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

/**
 * Starts monitoring one session.
 *
 * Invariant: the caller has already won the stream lease in `services/queue:claimStreams`, which
 * stamps the lease in the claiming mutation. This function only renews it, and aborts the moment a
 * renewal reports that another replica owns the session, so two workers never monitor it at once.
 */
export function startMonitor(runtime: WorkerRuntime, taskId: string) {
  if (runtime.stopping || runtime.monitors.has(taskId) || !runtime.monitorSlots.free()) return;
  const controller = new AbortController();
  runtime.monitors.set(taskId, controller);
  runtime.monitorSlots.take(1);
  const heartbeat = setInterval(() => {
    void mutate<{ claimed: boolean }>('services/queue:renewStream', {
      taskId,
      workerId: runtime.workerId,
    })
      .then((lease) => {
        if (!lease.claimed) controller.abort();
      })
      .catch(() => controller.abort());
  }, heartbeatMs);
  void monitorSession(runtime, taskId, controller)
    .catch((error) => console.error('Monitor stopped:', safeError(error)))
    .finally(() => {
      clearInterval(heartbeat);
      runtime.monitors.delete(taskId);
      runtime.monitorSlots.release(1);
    });
}

/** Aborts every monitor and releases its lease so another replica can take the session over. */
export async function releaseMonitors(runtime: WorkerRuntime) {
  const taskIds = [...runtime.monitors.keys()];
  for (const controller of runtime.monitors.values()) controller.abort();
  await Promise.all(
    taskIds.map((taskId) =>
      mutate('services/queue:releaseStream', { taskId, workerId: runtime.workerId }).catch((error) =>
        console.error('Stream release failed:', safeError(error)),
      ),
    ),
  );
}

async function monitorSession(runtime: WorkerRuntime, taskId: string, controller: AbortController) {
  const api = runtime.api;
  let reconnect = 0;
  while (!runtime.stopping && !controller.signal.aborted) {
    const context = await query<SessionContext>('services/sessions:sessionContext', { taskId });
    if (context.pendingInput || !context.task.sessionId || terminalStatuses.includes(context.task.status))
      return;
    const sessionId = context.task.sessionId;
    let stream: Awaited<ReturnType<typeof api.beta.agents.sessions.events.stream>> | undefined;
    let timer: NodeJS.Timeout | undefined, deadline: NodeJS.Timeout | undefined;
    const events: JournalEvent[] = [];
    const messages = new Map<string, JournalMessage>();
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
        if (turn?.status === 'completed') await archiveFiles(runtime, context);
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
        Math.max(1, runtime.maxRuntimeMs - (Date.now() - started)),
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
          if (event.type === 'agent.session.turn.completed') await archiveFiles(runtime, context);
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
      if (controller.signal.aborted || runtime.stopping) return;
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
