import { mutate, query } from '../../../lib/server/backend';
import { untrustedBlock, untrustedJson } from '../../../lib/server/untrusted';
import { GatewayError } from '../../gateway/errors';
import type { Job, TaskContext } from '../../types';
import type { WorkerRuntime } from '../state';
import { parseJsonAnswer, payload, runTurn, taskContext } from './context';
import type { TurnResult } from './runner';

/**
 * Fields `services/meetings:*Inputs` already fenced inside Convex. They arrive wrapped and are
 * passed through; everything else the worker fences here. See `lib/server/untrusted.ts`.
 */
interface MeetingInputs {
  meetingId: string;
  status: string;
  entry: { id: string; title: string; purpose: string; agenda: string[]; startsAt: number };
  attendees: { id: string; name: string }[];
  /** Already fenced by Convex. */
  recentWork?: string;
  transcript?: string;
  report?: string;
  question?: string;
  askedBy?: string;
  everyone?: boolean;
  openTasks?: { id: string; title: string; status: string; deadlineAt?: number }[];
}

interface Outcome {
  kind: 'task' | 'deadline' | 'meeting' | 'note';
  payload: string;
  text: string;
}

const OUTCOME_KINDS = ['task', 'deadline', 'meeting', 'note'];

/**
 * What this turn cost, out of a session total that counts every turn before it.
 *
 * An attendee prepares, answers each question, and wraps up on one session, and the session reports
 * its tokens cumulatively. Recording that figure as the answer's own cost would charge the second
 * answer for the preparation and the first answer as well, and the meeting's total would compound it.
 * The task carries what has already been recorded, so the difference is this turn's share.
 */
function turnUsage(context: TaskContext, result: TurnResult) {
  if (!result.usage) return undefined;
  const before = context.task.usage ?? { input: 0, cached: 0, output: 0 };
  const usage = {
    input: Math.max(0, result.usage.input - before.input),
    cached: Math.max(0, result.usage.cached - before.cached),
    output: Math.max(0, result.usage.output - before.output),
  };
  return usage.input || usage.cached || usage.output ? usage : undefined;
}

function requireMeeting(job: Job) {
  const input = payload(job);
  if (!input.meetingId || !input.employeeId)
    throw new GatewayError('invalid_arguments', 'A meeting turn needs its meeting and its attendee.');
  return { ...input, meetingId: input.meetingId, employeeId: input.employeeId };
}

/** The agenda, purpose, and attendee list as a working-memory section the turn opens with. */
function meetingSection(inputs: MeetingInputs) {
  return {
    heading: 'Meeting',
    lines: [
      `- ${inputs.entry.title} at ${new Date(inputs.entry.startsAt).toISOString().slice(0, 16)}`,
      `- Purpose: ${inputs.entry.purpose}`,
      // Agenda lines come from suggestions, from escalated audit findings, and from whoever edited
      // them. They are material to prepare against, never instruction.
      ...(inputs.entry.agenda.length ? ['- Agenda:', untrustedBlock(inputs.entry.agenda.join('\n'))] : []),
      `- Attending: ${inputs.attendees.map((one) => one.name).join(', ')}`,
    ],
  };
}

/** A bounded preparation turn at the meeting lead: one report against the agenda. */
export async function meetingPrep(runtime: WorkerRuntime, job: Job) {
  const input = requireMeeting(job);
  const context = await taskContext(job.taskId);
  const inputs = await query<MeetingInputs>('services/meetings:prepInputs', {
    meetingId: input.meetingId,
    employeeId: input.employeeId,
  });
  const result = await runTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    sections: [meetingSection(inputs)],
    brief: [
      'Prepare for this meeting. Write one short report against the agenda: where each item stands, what you need a decision on, and anything that will not be ready. People read this before the meeting opens.',
      ...(inputs.recentWork ? ['Your recent work, as you reported it', inputs.recentWork] : []),
      'Reply with the report itself and nothing else.',
    ],
  });
  await mutate('services/meetings:recordReport', {
    meetingId: input.meetingId,
    employeeId: input.employeeId,
    text: result.text || 'No preparation report was produced before the turn ended.',
  });
  const usage = turnUsage(context, result);
  if (usage) await mutate('services/meetings:meetingUsage', { meetingId: input.meetingId, usage });
}

/** One answer to one question. A question put to everyone gets a short answer. */
export async function meetingAnswer(runtime: WorkerRuntime, job: Job) {
  const input = requireMeeting(job);
  if (!input.turnId)
    throw new GatewayError('invalid_arguments', 'An answer turn needs the question it replies to.');
  const context = await taskContext(job.taskId);
  const inputs = await query<MeetingInputs>('services/meetings:answerInputs', {
    meetingId: input.meetingId,
    turnId: input.turnId,
    employeeId: input.employeeId,
  });
  const result = await runTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    sections: [meetingSection(inputs)],
    brief: [
      `${inputs.askedBy ?? 'A person'} asked:`,
      untrustedJson(inputs.question),
      ...(inputs.report ? ['Your own preparation report', inputs.report] : []),
      ...(inputs.transcript ? ['The meeting so far', inputs.transcript] : []),
      inputs.everyone
        ? 'This was put to everyone: answer in two sentences at most, only where you have something to add.'
        : 'This was addressed to you: answer it directly and completely, and say plainly what you do not know.',
      'Reply with the answer itself and nothing else.',
    ],
  });
  const usage = turnUsage(context, result);
  await mutate('services/meetings:recordAnswer', {
    meetingId: input.meetingId,
    turnId: input.turnId,
    employeeId: input.employeeId,
    text: result.text || 'No answer was produced before the turn ended.',
    ...(usage ? { usage } : {}),
  });
}

function parseOutcomes(message: string): Outcome[] {
  const parsed = parseJsonAnswer<{ outcomes?: unknown }>(message);
  if (!parsed || !Array.isArray(parsed.outcomes)) return [];
  return parsed.outcomes.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const outcome = row as Record<string, unknown>;
    if (typeof outcome.kind !== 'string' || !OUTCOME_KINDS.includes(outcome.kind)) return [];
    if (typeof outcome.text !== 'string' || !outcome.text.trim()) return [];
    return [
      {
        kind: outcome.kind as Outcome['kind'],
        payload:
          typeof outcome.payload === 'string' ? outcome.payload : JSON.stringify(outcome.payload ?? {}),
        text: outcome.text,
      },
    ];
  });
}

/**
 * The closing turn. Its proposals are exactly that: a person confirms which become tasks, calendar
 * entries, or replans, and `recordOutcomes` validates every payload again at that point.
 */
export async function meetingWrapup(runtime: WorkerRuntime, job: Job) {
  const input = requireMeeting(job);
  const context = await taskContext(job.taskId);
  const inputs = await query<MeetingInputs>('services/meetings:wrapupInputs', {
    meetingId: input.meetingId,
    employeeId: input.employeeId,
  });
  const result = await runTurn(runtime, job, context, {
    ...(input.model ? { model: input.model } : {}),
    sections: [meetingSection(inputs)],
    brief: [
      'The meeting is closing. Propose what should follow from it for you, and nothing more: action items, deadline changes, and a next meeting if one is needed. A person confirms each of these; proposing is not deciding.',
      ...(inputs.transcript ? ['The transcript', inputs.transcript] : []),
      ...(inputs.report ? ['Your own preparation report', inputs.report] : []),
      ...(inputs.openTasks?.length ? ['Your open work', untrustedJson(inputs.openTasks)] : []),
      'Reply with one JSON object: {"outcomes":[{"kind":"task|deadline|meeting|note","payload":"…","text":"…"}]}. `text` is the sentence a person reads; `payload` is the JSON the platform would act on.',
    ],
  });
  await mutate('services/meetings:recordOutcomes', {
    meetingId: input.meetingId,
    employeeId: input.employeeId,
    outcomes: parseOutcomes(result.text),
  });
  const usage = turnUsage(context, result);
  if (usage) await mutate('services/meetings:meetingUsage', { meetingId: input.meetingId, usage });
}
