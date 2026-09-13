import type { SessionCreateParamsNonStreaming } from 'openai/resources/beta/agents/sessions/sessions';
import { sessionUsage } from '../../../lib/server/agents';
import { mutate } from '../../../lib/server/backend';
import { safeError } from '../../../lib/server/secrets';
import type { Job, TaskContext } from '../../types';
import type { WorkerRuntime } from '../state';

export interface TurnUsage {
  input: number;
  cached: number;
  output: number;
}

export interface TurnRequest {
  job: Job;
  context: TaskContext;
  session: SessionCreateParamsNonStreaming;
  /** What the employee is asked to do this turn, working memory included. */
  input: string;
  /** Wall-clock bound on the turn, from `MAX_TURN_SECONDS`. */
  maxMs: number;
}

export interface TurnResult {
  /** The last assistant message of the turn, or empty when the turn produced none. */
  text: string;
  usage?: TurnUsage;
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
}

/**
 * One bounded turn on a session.
 *
 * Every job kind that needs a model goes through this, which is what lets the runtime harness drive
 * the gateway tools itself with a scripted runner: the OpenAI client is the only part of a turn that
 * cannot be reached from a test, and it lives behind this interface alone.
 */
export interface TurnRunner {
  run(runtime: WorkerRuntime, request: TurnRequest): Promise<TurnResult>;
}

const POLL_MS = 500;
const TERMINAL = ['completed', 'failed', 'cancelled'] as const;

/**
 * Session creation has no idempotency key and the sessions API cannot filter by metadata, so an
 * attempt after the first scans newest-first and stops at the task's own creation time.
 */
async function sessionFor(runtime: WorkerRuntime, request: TurnRequest) {
  const { job, context } = request;
  if (context.task.sessionId) return context.task.sessionId;
  let sessionId: string | undefined;
  if (job.attempts > 1) {
    let scanned = 0;
    for await (const candidate of runtime.api.beta.agents.sessions.list({ order: 'desc' })) {
      if (++scanned > 200 || candidate.created_at * 1000 < context.task.createdAt) break;
      if (candidate.metadata.ahq_task_id === context.task.id) {
        sessionId = candidate.id;
        break;
      }
    }
  }
  sessionId ??= (await runtime.api.beta.agents.sessions.create(request.session)).id;
  // Record before the first message, so a retry never creates a second session.
  await mutate('services/sessions:recordSession', {
    taskId: context.task.id,
    sessionId,
    leaseToken: job.leaseToken,
  });
  return sessionId;
}

/** The newest turn on a session, or none on a session that has never run one. */
async function newestTurn(runtime: WorkerRuntime, sessionId: string) {
  return (await runtime.api.beta.agents.sessions.turns.list(sessionId, { order: 'desc', limit: 1 })).data[0];
}

const openAiTurnRunner: TurnRunner = {
  async run(runtime, request) {
    const sessionId = await sessionFor(runtime, request);
    // The turn this input opens is the first one newer than what the session had. Polling the newest
    // turn alone read the previous, already finished turn and its answer as this one's.
    const previous = (await newestTurn(runtime, sessionId))?.id;
    await runtime.api.beta.agents.sessions.events.create(sessionId, {
      events: [
        {
          type: 'agent.session.input.message',
          input: [{ role: 'user', content: [{ type: 'input_text', text: request.input }] }],
        },
      ],
      'Idempotency-Key': request.job.id,
    });
    const deadline = Date.now() + request.maxMs;
    let status: TurnResult['status'] = 'timed_out';
    let turnId: string | undefined;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const turn = await newestTurn(runtime, sessionId);
      if (!turn || turn.id === previous) continue;
      turnId = turn.id;
      if ((TERMINAL as readonly string[]).includes(turn.status)) {
        status = turn.status as TurnResult['status'];
        break;
      }
    }
    if (status === 'timed_out')
      await runtime.api.beta.agents.sessions.events
        .create(sessionId, {
          events: [{ type: 'agent.session.input.cancel' }],
          'Idempotency-Key': `timeout:${request.job.id}`,
        })
        .catch((error: unknown) => console.error('Turn cancellation failed:', safeError(error)));
    let text = '';
    if (turnId)
      for await (const item of runtime.api.beta.agents.sessions.items.list(sessionId, { order: 'desc' })) {
        if (item.type !== 'message' || item.role !== 'assistant') continue;
        if (item.turn_id !== turnId) break;
        text = item.content.flatMap((part) => ('text' in part ? [part.text] : [])).join('\n');
        break;
      }
    const session = await runtime.api.beta.agents.sessions.retrieve(sessionId);
    return { text, status, ...(session.usage ? { usage: sessionUsage(session.usage) } : {}) };
  },
};

let installed: TurnRunner | undefined;

/** The harness installs a scripted runner; the worker process keeps the OpenAI one. */
export function installTurnRunner(runner: TurnRunner | undefined) {
  installed = runner;
}

export function turnRunner(): TurnRunner {
  return installed ?? openAiTurnRunner;
}
