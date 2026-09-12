import type { OutcomeKind } from '../../lib/contracts/meetings';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { cleanText, randomToken, untrustedBlock, type Ctx } from '../shared';
import { insertJob } from './tasks';

/** How many transcript turns a prompt carries by default. */
export const TRANSCRIPT_LIMIT = 40;

/** The instance's own name when it has one, otherwise the published employee name. */
export async function employeeName(ctx: Ctx, installation: Doc<'installations'>) {
  if (installation.name) return installation.name;
  const version = await ctx.db.get(installation.versionId);
  return version?.name || 'Employee';
}

/** The employee attendees of a calendar entry, resolved to live installations in its workspace. */
export async function attendeeEmployees(ctx: Ctx, entry: Doc<'calendarEntries'>) {
  const found: Doc<'installations'>[] = [];
  const seen = new Set<string>();
  for (const attendee of entry.attendees) {
    if (attendee.kind !== 'employee' || seen.has(attendee.id)) continue;
    seen.add(attendee.id);
    const id = ctx.db.normalizeId('installations', attendee.id);
    const installation = id ? await ctx.db.get(id) : null;
    if (!installation || installation.workspaceId !== entry.workspaceId) continue;
    if (installation.status === 'retired') continue;
    found.push(installation);
  }
  return found;
}

/** A meeting with its calendar entry and employee attendees. */
export async function meetingContext(ctx: Ctx, meetingId: Id<'meetings'>) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error('Meeting not found');
  const entry = await ctx.db.get(meeting.calendarEntryId);
  if (!entry) throw new Error('Calendar entry not found');
  return { meeting, entry, attendees: await attendeeEmployees(ctx, entry) };
}

/** Every turn of a meeting in the order it was spoken. */
export async function meetingTurns(ctx: Ctx, meetingId: Id<'meetings'>) {
  return ctx.db
    .query('meetingTurns')
    .withIndex('by_meeting', (q) => q.eq('meetingId', meetingId))
    .collect();
}

/**
 * The transcript a prompt carries: the last `limit` turns, newest last. Every line is agent- or
 * person-written text going into a model, so callers wrap the result before it enters a prompt.
 */
export function transcriptText(turns: Doc<'meetingTurns'>[], limit = TRANSCRIPT_LIMIT) {
  return turns
    .slice(-Math.max(0, limit))
    .map((turn) => `${turn.authorName} (${turn.kind}): ${turn.text}`)
    .join('\n');
}

function meetingPrompt(entry: Doc<'calendarEntries'>) {
  const lines = [
    `You are attending the meeting "${entry.title}".`,
    entry.purpose ? `Purpose: ${entry.purpose}` : '',
    entry.agenda.length ? `Agenda:\n${entry.agenda.map((item) => `- ${item}`).join('\n')}` : '',
    entry.attendees.length ? `Attendees: ${entry.attendees.map((one) => one.name).join(', ')}.` : '',
    'This session carries your preparation, your answers, and your wrap-up for this meeting.',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/**
 * One hidden task per attendee per meeting. The worker runs prep, answers, and the wrap-up on that
 * task's session, so the employee keeps its own meeting context across every turn. The task carries
 * no `start_task` job: the meeting job kinds are its input, and `finalize` completes it.
 */
export async function meetingTaskFor(
  ctx: MutationCtx,
  meeting: Doc<'meetings'>,
  entry: Doc<'calendarEntries'>,
  installation: Doc<'installations'>,
) {
  const uniqueKey = `meeting_prep:${meeting._id}:${installation._id}`;
  const existing = await ctx.db
    .query('jobs')
    .withIndex('by_unique_key', (q) => q.eq('uniqueKey', uniqueKey))
    .unique();
  if (existing) return existing.taskId;
  const version = await ctx.db.get(installation.versionId);
  if (!version) throw new Error('Employee version not found');
  const floor = installation.floorId ? await ctx.db.get(installation.floorId) : null;
  const now = Date.now();
  const taskId = await ctx.db.insert('tasks', {
    workspaceId: entry.workspaceId,
    ...(floor ? { floorId: floor._id, floorContext: { name: floor.name, brief: floor.brief } } : {}),
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    cadence: 'once',
    createdBy: entry.createdBy || 'system',
    createdByName: 'Meeting',
    visibility: 'workspace',
    employeeId: installation._id,
    versionId: version._id,
    employeeName: installation.name || version.name,
    title: `Meeting: ${entry.title}`.slice(0, 200),
    prompt: meetingPrompt(entry),
    status: 'queued',
    model: version.model,
    createdAt: now,
    updatedAt: now,
    runToken: randomToken(),
  });
  await insertJob(ctx, {
    workspaceId: entry.workspaceId,
    taskId,
    uniqueKey,
    kind: 'meeting_prep',
    payload: JSON.stringify({ meetingId: meeting._id, employeeId: installation._id }),
  });
  return taskId;
}

/**
 * The meeting for a calendar entry, created on first use with one hidden task and one prep job per
 * attendee. Safe to call again: the meeting, the tasks, and the jobs are all keyed.
 */
export async function ensureMeeting(ctx: MutationCtx, entry: Doc<'calendarEntries'>) {
  if (entry.kind !== 'meeting') throw new Error('Calendar entry is not a meeting');
  const existing = await ctx.db
    .query('meetings')
    .withIndex('by_entry', (q) => q.eq('calendarEntryId', entry._id))
    .unique();
  const meeting =
    existing ??
    (await ctx.db.get(
      await ctx.db.insert('meetings', {
        workspaceId: entry.workspaceId,
        calendarEntryId: entry._id,
        status: 'preparing',
        createdAt: Date.now(),
      }),
    ));
  if (!meeting) throw new Error('Meeting not found');
  if (meeting.status !== 'closed')
    for (const attendee of await attendeeEmployees(ctx, entry))
      await meetingTaskFor(ctx, meeting, entry, attendee);
  return meeting._id;
}

/** Adds one turn's reported tokens to the meeting total, so the boardroom can price a question. */
export async function addMeetingUsage(
  ctx: MutationCtx,
  meeting: Doc<'meetings'>,
  usage: { input: number; cached: number; output: number },
) {
  if ([usage.input, usage.cached, usage.output].some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Usage values must be finite and non-negative');
  const current = meeting.usage || { input: 0, cached: 0, output: 0 };
  await ctx.db.patch(meeting._id, {
    usage: {
      input: current.input + usage.input,
      cached: current.cached + usage.cached,
      output: current.output + usage.output,
    },
  });
}

/** Recent reports by one employee, the tasks they came from, and those tasks' summaries. */
export async function employeeWork(ctx: Ctx, employeeId: Id<'installations'>, limit: number) {
  const reports = await ctx.db
    .query('reports')
    .withIndex('by_employee', (q) => q.eq('employeeId', employeeId))
    .order('desc')
    .take(limit);
  const taskIds = [...new Set(reports.map((report) => String(report.taskId)))].map((id) => id as Id<'tasks'>);
  const tasks = (await Promise.all(taskIds.map((taskId) => ctx.db.get(taskId)))).filter(
    (task): task is Doc<'tasks'> => task !== null,
  );
  const summaries = (
    await Promise.all(
      tasks.map((task) =>
        ctx.db
          .query('taskSummaries')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .first(),
      ),
    )
  ).filter((summary): summary is Doc<'taskSummaries'> => summary !== null);
  return { reports, tasks, summaries };
}

/** The meeting context every turn prompt shares: the entry, the attendees, and the transcript. */
export async function turnInputs(ctx: Ctx, meetingId: Id<'meetings'>, employeeId: Id<'installations'>) {
  const { meeting, entry, attendees } = await meetingContext(ctx, meetingId);
  if (!attendees.some((attendee) => attendee._id === employeeId))
    throw new Error('Employee is not an attendee of this meeting');
  const turns = await meetingTurns(ctx, meetingId);
  return {
    meeting,
    entry,
    attendees,
    turns,
    inputs: {
      meetingId: meeting._id,
      status: meeting.status,
      entry: {
        id: entry._id,
        title: entry.title,
        purpose: entry.purpose,
        agenda: entry.agenda,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        projectId: entry.projectId,
        floorId: entry.floorId,
      },
      attendees: await Promise.all(
        attendees.map(async (attendee) => ({
          id: attendee._id,
          name: await employeeName(ctx, attendee),
        })),
      ),
    },
  };
}

/** The employee's own preparation report for this meeting, delimited for a prompt. */
export function ownReport(turns: Doc<'meetingTurns'>[], employeeId: Id<'installations'>) {
  const report = turns.find((turn) => turn.kind === 'report' && turn.employeeId === employeeId);
  return report ? untrustedBlock(report.text) : undefined;
}

export type OutcomePayload =
  | { kind: 'task'; title: string; prompt: string; employeeId: Id<'installations'> }
  | { kind: 'deadline'; taskId: Id<'tasks'>; deadlineAt: number }
  | {
      kind: 'meeting';
      title: string;
      startsAt: number;
      endsAt: number;
      agenda: string[];
      purpose?: string;
      attendees: Id<'installations'>[];
    }
  | { kind: 'note'; text: string };

function fields(payload: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Outcome payload is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Outcome payload must be an object');
  return parsed as Record<string, unknown>;
}

function textField(source: Record<string, unknown>, field: string, max: number) {
  const value = source[field];
  if (typeof value !== 'string') throw new Error(`Outcome ${field} is required`);
  return cleanText(value, `Outcome ${field}`, max);
}

function numberField(source: Record<string, unknown>, field: string) {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Outcome ${field} must be a number`);
  return value;
}

function stringsField(source: Record<string, unknown>, field: string, max: number) {
  const value = source[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`Outcome ${field} must be a list of strings`);
  return (value as string[]).slice(0, 50).map((item) => cleanText(item, `Outcome ${field}`, max));
}

function idField<Table extends 'installations' | 'tasks'>(
  source: Record<string, unknown>,
  field: string,
): Id<Table> {
  const value = source[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Outcome ${field} is required`);
  return value as Id<Table>;
}

/**
 * Outcomes arrive as JSON an agent wrote, so every field is checked here before it is stored and
 * again, against the database, when a person confirms it.
 */
export function parseOutcomePayload(kind: OutcomeKind, payload: string): OutcomePayload {
  const source = fields(payload);
  switch (kind) {
    case 'task':
      return {
        kind,
        title: textField(source, 'title', 200),
        prompt: textField(source, 'prompt', 20_000),
        employeeId: idField<'installations'>(source, 'employeeId'),
      };
    case 'deadline':
      return {
        kind,
        taskId: idField<'tasks'>(source, 'taskId'),
        deadlineAt: numberField(source, 'deadlineAt'),
      };
    case 'meeting':
      return {
        kind,
        title: textField(source, 'title', 200),
        startsAt: numberField(source, 'startsAt'),
        endsAt: numberField(source, 'endsAt'),
        agenda: stringsField(source, 'agenda', 500),
        ...(source.purpose === undefined ? {} : { purpose: textField(source, 'purpose', 2_000) }),
        attendees: stringsField(source, 'attendees', 100) as Id<'installations'>[],
      };
    case 'note':
      return { kind, text: textField(source, 'text', 5_000) };
  }
}

/** The employee's recent work, rendered for a prompt: its last reports and finished task summaries. */
export function workText(work: {
  reports: Doc<'reports'>[];
  tasks: Doc<'tasks'>[];
  summaries: Doc<'taskSummaries'>[];
}) {
  const titles = new Map(work.tasks.map((task) => [String(task._id), task.title]));
  const lines = work.reports.map((report) => {
    const parts = [
      report.done.length ? `done: ${report.done.join('; ')}` : '',
      report.inProgress.length ? `in progress: ${report.inProgress.join('; ')}` : '',
      report.blockedOn.length ? `blocked on: ${report.blockedOn.join('; ')}` : '',
      report.next.length ? `next: ${report.next.join('; ')}` : '',
      report.risks.length ? `risks: ${report.risks.join('; ')}` : '',
    ].filter(Boolean);
    return `Report on ${titles.get(String(report.taskId)) || 'a task'} — ${parts.join(' | ')}`;
  });
  for (const summary of work.summaries)
    lines.push(`Summary of ${titles.get(String(summary.taskId)) || 'a task'} — ${summary.outcome}`);
  return lines.join('\n');
}
