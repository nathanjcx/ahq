import { v } from 'convex/values';
import type { Attendee } from '../../lib/contracts';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { attendee as attendeeValidator } from '../schema';
import { cleanText, type Ctx } from '../shared';

const DAY_MS = 86_400_000;
const MAX_ATTENDEES = 25;
export const MAX_AGENDA_ITEMS = 20;
/** Longest meeting a person can book, in hours. */
const MAX_MEETING_HOURS = 12;
/** How far ahead or behind a meeting may be booked, in days. */
const MAX_BOOKING_DAYS = 730;

/** What it takes to book a meeting, whether a person, a meeting outcome, or a roadmap asks for it. */
export interface MeetingRequest {
  title: string;
  startsAt: number;
  endsAt: number;
  projectId?: Id<'projects'>;
  floorId?: Id<'floors'>;
  attendees: { kind: 'employee' | 'person'; id: string; name: string }[];
  agenda: string[];
  purpose?: string;
}

/** The same fields as Convex arguments, so every route that books a meeting takes the same shape. */
export const meetingArgs = {
  title: v.string(),
  startsAt: v.number(),
  endsAt: v.number(),
  projectId: v.optional(v.id('projects')),
  floorId: v.optional(v.id('floors')),
  attendees: v.array(attendeeValidator),
  agenda: v.array(v.string()),
  purpose: v.optional(v.string()),
};

/** Checked meeting fields. Attendees must be real instances; people are named by their WorkOS user id. */
export async function meetingFields(ctx: Ctx, workspaceId: Id<'workspaces'>, input: MeetingRequest) {
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

/**
 * The one path that books a meeting: the calendar, a confirmed meeting outcome, and a confirmed
 * roadmap all arrive here, so one set of rules decides what a meeting may be.
 */
export async function createMeetingEntry(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  actor: { subject: string },
  request: MeetingRequest,
) {
  const fields = await meetingFields(ctx, workspace._id, request);
  const now = Date.now();
  return ctx.db.insert('calendarEntries', {
    workspaceId: workspace._id,
    kind: 'meeting',
    ...fields,
    status: 'scheduled',
    createdBy: actor.subject,
    createdAt: now,
    updatedAt: now,
  });
}

/** Adds items to a meeting's agenda, keeping it inside the limit and free of repeats. */
export async function appendAgenda(
  ctx: MutationCtx,
  entry: Doc<'calendarEntries'>,
  items: string[],
): Promise<string[]> {
  const agenda = [...entry.agenda];
  for (const item of items) {
    const text = cleanText(item, 'Agenda item', 1_000);
    if (agenda.length >= MAX_AGENDA_ITEMS || agenda.includes(text)) continue;
    agenda.push(text);
  }
  if (agenda.length === entry.agenda.length) return entry.agenda;
  await ctx.db.patch(entry._id, { agenda, updatedAt: Date.now() });
  return agenda;
}

/** The next meeting a workspace has booked, which is where an escalation is put on the record. */
export async function nextScheduledMeeting(ctx: Ctx, workspaceId: Id<'workspaces'>, now = Date.now()) {
  const entries = await ctx.db
    .query('calendarEntries')
    .withIndex('by_workspace_start', (q) => q.eq('workspaceId', workspaceId).gte('startsAt', now))
    .take(50);
  return entries.find((entry) => entry.kind === 'meeting' && entry.status === 'scheduled') ?? null;
}
