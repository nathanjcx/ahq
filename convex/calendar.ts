import { v } from 'convex/values';
import type { AgendaSuggestion, Attendee, CalendarEntry } from '../lib/contracts';
import { localParts, overnightWindow, startOfDay } from '../lib/time';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { settingsFor } from './lib/schedule';
import { attendee as attendeeValidator } from './schema';
import { cleanText, requireWorkspace, type Ctx } from './shared';

const DAY_MS = 86_400_000;
/** Days one calendar read may span. A week or a month view fits; a year does not. */
const MAX_RANGE_DAYS = 62;
const MAX_ATTENDEES = 25;
const MAX_AGENDA_ITEMS = 20;
/** Longest meeting a person can book, in hours. */
const MAX_MEETING_HOURS = 12;
/** How far ahead or behind a meeting may be booked, in days. */
const MAX_BOOKING_DAYS = 730;
/** Reports at or below this confidence read as behind. */
const BEHIND_CONFIDENCE = 0.5;
const SUGGESTIONS_PER_REASON = 5;

/** Every local date the range touches, with an instant inside each one. */
function datesBetween(from: number, to: number, timezone: string) {
  const days: { date: string; noon: number }[] = [];
  let cursor = startOfDay(from, timezone) + 12 * 3_600_000;
  for (let day = 0; day < MAX_RANGE_DAYS && cursor < to + DAY_MS; day++, cursor += DAY_MS)
    days.push({ date: localParts(cursor, timezone).date, noon: cursor });
  return days;
}

async function employeeNames(ctx: Ctx, workspaceId: Id<'workspaces'>) {
  const names = new Map<string, string>();
  for (const installation of await ctx.db
    .query('installations')
    .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
    .collect()) {
    const version = await ctx.db.get(installation.versionId);
    names.set(installation._id, installation.name ?? version?.name ?? 'Employee');
  }
  return names;
}

function storedEntry(entry: Doc<'calendarEntries'>, meetingId?: Id<'meetings'>): CalendarEntry {
  return {
    id: entry._id,
    kind: entry.kind,
    title: entry.title,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    projectId: entry.projectId,
    floorId: entry.floorId,
    taskId: entry.taskId,
    attendees: entry.attendees,
    agenda: entry.agenda,
    purpose: entry.purpose,
    status: entry.status,
    meetingId,
  };
}

/**
 * The calendar for a range: meetings as they were booked, and deadlines, shifts, and the nightly
 * audit derived from the work itself, so nothing has to be kept in step with a second copy.
 */
export const entries = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args): Promise<CalendarEntry[]> => {
    const { workspace } = await requireWorkspace(ctx);
    if (!(args.to > args.from)) throw new Error('The calendar range must end after it starts');
    const to = Math.min(args.to, args.from + MAX_RANGE_DAYS * DAY_MS);
    const settings = await settingsFor(ctx, workspace._id);
    const names = await employeeNames(ctx, workspace._id);
    const [stored, tasks, installations] = await Promise.all([
      ctx.db
        .query('calendarEntries')
        .withIndex('by_workspace_start', (q) =>
          q.eq('workspaceId', workspace._id).gte('startsAt', args.from).lte('startsAt', to),
        )
        .collect(),
      ctx.db
        .query('tasks')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
        .order('desc')
        .take(500),
      ctx.db
        .query('installations')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
        .collect(),
    ]);

    const result: CalendarEntry[] = [];
    for (const entry of stored) {
      const meeting =
        entry.kind === 'meeting'
          ? await ctx.db
              .query('meetings')
              .withIndex('by_entry', (q) => q.eq('calendarEntryId', entry._id))
              .unique()
          : null;
      result.push(storedEntry(entry, meeting?._id));
    }

    for (const task of tasks) {
      if (task.deadlineAt === undefined || task.deadlineAt < args.from || task.deadlineAt > to) continue;
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      result.push({
        id: `deadline:${task._id}`,
        kind: 'deadline',
        title: task.title,
        startsAt: task.deadlineAt,
        endsAt: task.deadlineAt,
        projectId: task.projectId,
        floorId: task.floorId,
        taskId: task._id,
        attendees: [{ kind: 'employee', id: task.employeeId, name: task.employeeName }],
        agenda: [],
        status: 'scheduled',
      });
    }
    for (const project of await ctx.db
      .query('projects')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect())
      for (const milestone of await ctx.db
        .query('milestones')
        .withIndex('by_project', (q) => q.eq('projectId', project._id))
        .collect()) {
        if (milestone.deadlineAt === undefined || milestone.status === 'done') continue;
        if (milestone.deadlineAt < args.from || milestone.deadlineAt > to) continue;
        result.push({
          id: `deadline:${milestone._id}`,
          kind: 'deadline',
          title: `${project.name}: ${milestone.title}`,
          startsAt: milestone.deadlineAt,
          endsAt: milestone.deadlineAt,
          projectId: project._id,
          attendees: [],
          agenda: [],
          status: 'scheduled',
        });
      }

    const days = datesBetween(args.from, to, settings.timezone);
    for (const day of days)
      for (const shift of await ctx.db
        .query('shifts')
        .withIndex('by_workspace_date', (q) => q.eq('workspaceId', workspace._id).eq('date', day.date))
        .collect()) {
        if (shift.startedAt > to || (shift.endedAt ?? shift.startedAt) < args.from) continue;
        const task = await ctx.db.get(shift.taskId);
        result.push({
          id: `shift:${shift._id}`,
          kind: 'shift',
          title: task?.title ?? 'Shift',
          startsAt: shift.startedAt,
          endsAt: shift.endedAt ?? shift.startedAt,
          projectId: task?.projectId,
          floorId: task?.floorId,
          taskId: shift.taskId,
          attendees: [
            { kind: 'employee', id: shift.employeeId, name: names.get(shift.employeeId) ?? 'Employee' },
          ],
          agenda: [],
          status: shift.endedAt === undefined ? 'live' : 'done',
        });
      }

    const auditors: Attendee[] = installations
      .filter((installation) => installation.kind === 'auditor' && installation.status !== 'retired')
      .map((installation) => ({
        kind: 'employee',
        id: installation._id,
        name: names.get(installation._id) ?? 'Auditor',
      }));
    const nights = new Set<number>();
    if (auditors.length && settings.overnightPolicy !== 'off')
      for (const day of days) {
        const night = overnightWindow(day.noon, settings);
        // A weekend is one long night, so several days name the same window.
        if (!night || night.start < args.from || night.start > to || nights.has(night.start)) continue;
        nights.add(night.start);
        result.push({
          id: `audit:${localParts(night.start, settings.timezone).date}`,
          kind: 'audit',
          title: 'Nightly audit',
          startsAt: night.start,
          endsAt: night.end,
          attendees: auditors,
          agenda: [],
          status: night.end <= Date.now() ? 'done' : 'scheduled',
        });
      }
    return result.sort((a, b) => a.startsAt - b.startsAt);
  },
});

/** Checked meeting fields. Attendees must be real instances; people are named by their Clerk subject. */
async function meetingFields(
  ctx: Ctx,
  workspaceId: Id<'workspaces'>,
  input: {
    title: string;
    startsAt: number;
    endsAt: number;
    projectId?: Id<'projects'>;
    floorId?: Id<'floors'>;
    attendees: { kind: 'employee' | 'person'; id: string; name: string }[];
    agenda: string[];
    purpose?: string;
  },
) {
  const now = Date.now();
  if (!Number.isFinite(input.startsAt) || !Number.isFinite(input.endsAt))
    throw new Error('A meeting needs a start and an end');
  if (input.endsAt <= input.startsAt) throw new Error('A meeting must end after it starts');
  if (input.endsAt - input.startsAt > MAX_MEETING_HOURS * 3_600_000)
    throw new Error(`A meeting cannot run longer than ${MAX_MEETING_HOURS} hours`);
  if (Math.abs(input.startsAt - now) > MAX_BOOKING_DAYS * DAY_MS)
    throw new Error('That meeting time is too far from today');
  if (input.attendees.length > MAX_ATTENDEES) throw new Error('That is too many attendees');
  if (new Set(input.attendees.map((one) => one.id)).size !== input.attendees.length)
    throw new Error('An attendee is listed twice');
  if (input.agenda.length > MAX_AGENDA_ITEMS) throw new Error('That is too many agenda items');
  if (input.projectId) {
    const project = await ctx.db.get(input.projectId);
    if (!project || project.workspaceId !== workspaceId) throw new Error('Project not found');
  }
  if (input.floorId) {
    const floor = await ctx.db.get(input.floorId);
    if (!floor || floor.workspaceId !== workspaceId) throw new Error('Floor not found');
  }
  const attendees: Attendee[] = [];
  for (const one of input.attendees) {
    if (one.kind === 'person') {
      attendees.push({
        kind: 'person',
        id: cleanText(one.id, 'Attendee', 200),
        name: cleanText(one.name, 'Attendee name', 200),
      });
      continue;
    }
    const installation = await ctx.db.get(one.id as Id<'installations'>);
    if (!installation || installation.workspaceId !== workspaceId) throw new Error('Employee not found');
    if (installation.status === 'retired') throw new Error('That employee has been retired');
    const version = await ctx.db.get(installation.versionId);
    attendees.push({
      kind: 'employee',
      id: installation._id,
      name: installation.name ?? version?.name ?? 'Employee',
    });
  }
  return {
    title: cleanText(input.title, 'Meeting title', 200),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    projectId: input.projectId,
    floorId: input.floorId,
    attendees,
    agenda: input.agenda.map((item) => cleanText(item, 'Agenda item', 1_000)),
    purpose: input.purpose?.trim() ? cleanText(input.purpose, 'Purpose', 5_000) : undefined,
  };
}

const meetingArgs = {
  title: v.string(),
  startsAt: v.number(),
  endsAt: v.number(),
  projectId: v.optional(v.id('projects')),
  floorId: v.optional(v.id('floors')),
  attendees: v.array(attendeeValidator),
  agenda: v.array(v.string()),
  purpose: v.optional(v.string()),
};

/** Books a meeting. Only people create calendar entries; everything else on the calendar is derived. */
export const createMeeting = mutation({
  args: meetingArgs,
  returns: v.object({ entryId: v.id('calendarEntries') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const fields = await meetingFields(ctx, workspace._id, args);
    const now = Date.now();
    const entryId = await ctx.db.insert('calendarEntries', {
      workspaceId: workspace._id,
      kind: 'meeting',
      ...fields,
      status: 'scheduled',
      createdBy: actor.subject,
      createdAt: now,
      updatedAt: now,
    });
    return { entryId };
  },
});

async function requireMeeting(ctx: Ctx, workspaceId: Id<'workspaces'>, entryId: Id<'calendarEntries'>) {
  const entry = await ctx.db.get(entryId);
  if (!entry || entry.workspaceId !== workspaceId || entry.kind !== 'meeting')
    throw new Error('Meeting not found');
  return entry;
}

/** Changes a booked meeting. A cancelled or finished meeting is history and stays as it was. */
export const updateMeeting = mutation({
  args: { entryId: v.id('calendarEntries'), ...meetingArgs },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const entry = await requireMeeting(ctx, workspace._id, args.entryId);
    if (entry.status !== 'scheduled') throw new Error('That meeting can no longer be changed');
    const fields = await meetingFields(ctx, workspace._id, args);
    await ctx.db.patch(entry._id, { ...fields, updatedAt: Date.now() });
    return null;
  },
});

/** Cancels a meeting, keeping the entry so the calendar still explains the gap. */
export const cancelMeeting = mutation({
  args: { entryId: v.id('calendarEntries') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const entry = await requireMeeting(ctx, workspace._id, args.entryId);
    await ctx.db.patch(entry._id, { status: 'cancelled', updatedAt: Date.now() });
    return null;
  },
});

/**
 * What is worth discussing at a meeting held at this time: work due before it, employees who say
 * they are behind, memory nobody agrees on, and anything open against the workspace.
 */
export const suggestAgenda = query({
  args: {
    startsAt: v.number(),
    projectId: v.optional(v.id('projects')),
    floorId: v.optional(v.id('floors')),
  },
  handler: async (ctx, args): Promise<AgendaSuggestion[]> => {
    const { workspace } = await requireWorkspace(ctx);
    const suggestions: AgendaSuggestion[] = [];
    const inScope = (row: { projectId?: Id<'projects'>; floorId?: Id<'floors'> }) =>
      (!args.projectId || row.projectId === args.projectId) &&
      (!args.floorId || row.floorId === args.floorId);

    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .order('desc')
      .take(500);
    const due = tasks.filter(
      (task) =>
        inScope(task) &&
        task.deadlineAt !== undefined &&
        task.deadlineAt <= args.startsAt &&
        task.status !== 'completed' &&
        task.status !== 'cancelled',
    );
    for (const task of due.slice(0, SUGGESTIONS_PER_REASON))
      suggestions.push({
        text: `${task.title} is due before this meeting`,
        reason: 'deadline',
        refId: task._id,
      });

    for (const project of await ctx.db
      .query('projects')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect()) {
      if (args.projectId && project._id !== args.projectId) continue;
      for (const milestone of await ctx.db
        .query('milestones')
        .withIndex('by_project', (q) => q.eq('projectId', project._id))
        .collect())
        if (
          milestone.status !== 'done' &&
          milestone.deadlineAt !== undefined &&
          milestone.deadlineAt <= args.startsAt
        )
          suggestions.push({
            text: `Milestone ${milestone.title} is due before this meeting`,
            reason: 'milestone',
            refId: milestone._id,
          });
    }

    let behind = 0;
    for (const task of tasks) {
      if (behind >= SUGGESTIONS_PER_REASON) break;
      if (!inScope(task) || task.status === 'cancelled') continue;
      const report = await ctx.db
        .query('reports')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))
        .order('desc')
        .first();
      if (!report || report.deadlineConfidence === undefined) continue;
      if (report.deadlineConfidence >= BEHIND_CONFIDENCE) continue;
      behind += 1;
      suggestions.push({
        text: `${task.employeeName} reports ${task.title} is behind`,
        reason: 'behind',
        refId: task._id,
      });
    }

    for (const memory of await ctx.db
      .query('memories')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id).eq('status', 'contested'))
      .take(SUGGESTIONS_PER_REASON))
      suggestions.push({ text: `Contested: ${memory.text}`, reason: 'contested', refId: memory._id });

    for (const installation of await ctx.db
      .query('installations')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect())
      for (const finding of await ctx.db
        .query('auditFindings')
        .withIndex('by_employee_status', (q) => q.eq('employeeId', installation._id).eq('status', 'open'))
        .take(SUGGESTIONS_PER_REASON))
        suggestions.push({ text: `Open finding: ${finding.claim}`, reason: 'finding', refId: finding._id });

    for (const alert of await ctx.db
      .query('alerts')
      .withIndex('by_workspace_status', (q) => q.eq('workspaceId', workspace._id).eq('status', 'open'))
      .take(SUGGESTIONS_PER_REASON))
      suggestions.push({ text: `Open alert: ${alert.title}`, reason: 'alert', refId: alert._id });

    return suggestions.slice(0, MAX_AGENDA_ITEMS);
  },
});
