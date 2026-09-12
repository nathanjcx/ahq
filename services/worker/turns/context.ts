import type { ModelId } from '../../../lib/contracts';
import {
  sessionConfiguration,
  workingMemory,
  type SessionOptions,
  type TurnMemoryOptions,
} from '../../../lib/server/agents';
import { mutate, query } from '../../../lib/server/backend';
import type { Job, TaskContext } from '../../types';
import type { WorkerRuntime } from '../state';
import { turnRunner, type TurnResult } from './runner';

/** What the planner put in a job's payload. Every field is optional to the reader; the kind decides. */
export interface TurnPayload {
  workspaceId?: string;
  employeeId?: string;
  date?: string;
  model?: ModelId;
  findingIds?: string[];
  meetingId?: string;
  entryId?: string;
  turnId?: string;
  alertId?: string;
  projectId?: string;
  reason?: string;
}

export function payload(job: Job): TurnPayload {
  return job.payload;
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function taskContext(taskId: string) {
  return query<TaskContext>('services/sessions:taskContext', { taskId });
}

/**
 * What a turn leaves in the record: its final message and what it cost.
 *
 * The message matters beyond the transcript. A shift that ends without filing a report has one
 * inferred from the journal, and a task summary falls back the same way, so a turn whose words were
 * never written down would leave both of those with nothing to say.
 */
export async function recordTurn(job: Job, taskId: string, result: TurnResult) {
  await mutate('services/sessions:recordEvents', {
    taskId,
    events: [],
    ...(result.text
      ? {
          messages: [
            {
              externalId: `turn:${job.id}`,
              role: 'assistant' as const,
              text: result.text,
              createdAt: Date.now(),
              completed: true,
            },
          ],
        }
      : {}),
    ...(result.usage ? { usage: result.usage } : {}),
  });
}

export interface TurnOptions extends SessionOptions, TurnMemoryOptions {
  /** Sections appended after the working memory block, in the order the employee reads them. */
  brief: string[];
}

/**
 * Runs one turn for a job: compiles the working memory, builds the session for the role, sends the
 * brief, and records what it cost. The turn's own result is left to the caller, because what counts
 * as a result differs per job kind — a report, an answer, a set of findings, a roadmap.
 */
export async function runTurn(
  runtime: WorkerRuntime,
  job: Job,
  context: TaskContext,
  options: TurnOptions,
): Promise<TurnResult> {
  const { brief, title, sections, ...session } = options;
  const memory = await workingMemory(context.task.id, { title, sections });
  const result = await turnRunner().run(runtime, {
    job,
    context,
    session: sessionConfiguration(context, session),
    input: [memory.text, ...brief].filter(Boolean).join('\n\n'),
    maxMs: runtime.maxRuntimeMs,
  });
  await recordTurn(job, context.task.id, result);
  return result;
}

/**
 * The same turn without working memory, for the two runs that are pure model calls over inputs the
 * platform hands them: the email classifier and the project planner.
 */
export async function runBareTurn(
  runtime: WorkerRuntime,
  job: Job,
  context: TaskContext,
  options: TurnOptions,
): Promise<TurnResult> {
  const { brief, title: _title, sections: _sections, ...session } = options;
  const result = await turnRunner().run(runtime, {
    job,
    context,
    session: sessionConfiguration(context, session),
    input: brief.filter(Boolean).join('\n\n'),
    maxMs: runtime.maxRuntimeMs,
  });
  await recordTurn(job, context.task.id, result);
  return result;
}

/**
 * A structured answer parsed out of a turn's final message.
 *
 * Turns that write through a tool need no parsing; these are the ones whose result is the message
 * itself, and a model that wraps its JSON in prose or a fence is a normal outcome, not a failure.
 */
export function parseJsonAnswer<T>(message: string): T | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(message);
  const candidate = fenced ? fenced[1] : message.slice(message.indexOf('{'), message.lastIndexOf('}') + 1);
  if (!candidate.trim()) return undefined;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return undefined;
  }
}
