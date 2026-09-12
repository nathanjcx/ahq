import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { createMeetingEntry } from './lib/calendar';
import {
  ensureMeeting,
  meetingContext,
  meetingTaskFor,
  meetingTurns,
  parseOutcomePayload,
} from './lib/meetings';
import { assertEmployeeReady, assertTokenCap, assignmentForFloor, insertJob, startTask } from './lib/tasks';
import { cleanText, requireWorkspace } from './shared';

function publicTurn(turn: Doc<'meetingTurns'>) {
  return {
    id: turn._id,
    kind: turn.kind,
    authorName: turn.authorName,
    authorSubject: turn.authorSubject,
    employeeId: turn.employeeId,
    addressedTo: turn.addressedTo,
    inReplyTo: turn.inReplyTo,
    text: turn.text,
    usage: turn.usage,
    outcome: turn.outcome,
    createdAt: turn.createdAt,
  };
}

/** A meeting in this workspace, with its calendar entry and employee attendees. */
async function meetingFor(ctx: MutationCtx, workspaceId: Id<'workspaces'>, meetingId: Id<'meetings'>) {
  const context = await meetingContext(ctx, meetingId);
  if (context.meeting.workspaceId !== workspaceId) throw new Error('Meeting not found');
  return context;
}

async function entryFor(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  calendarEntryId: Id<'calendarEntries'>,
) {
  const entry = await ctx.db.get(calendarEntryId);
  if (!entry || entry.workspaceId !== workspaceId) throw new Error('Calendar entry not found');
  return entry;
}

/** The boardroom view: the meeting for a calendar entry and every turn spoken in it. */
export const get = query({
  args: { calendarEntryId: v.id('calendarEntries') },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const entry = await ctx.db.get(args.calendarEntryId);
    if (!entry || entry.workspaceId !== workspace._id) throw new Error('Calendar entry not found');
    const meeting = await ctx.db
      .query('meetings')
      .withIndex('by_entry', (q) => q.eq('calendarEntryId', entry._id))
      .unique();
    if (!meeting) return null;
    return {
      id: meeting._id,
      calendarEntryId: meeting.calendarEntryId,
      status: meeting.status,
      openedBy: meeting.openedBy,
      openedAt: meeting.openedAt,
      closedAt: meeting.closedAt,
      usage: meeting.usage,
      turns: (await meetingTurns(ctx, meeting._id)).map(publicTurn),
    };
  },
});

/** Creates the meeting, its hidden per-attendee task, and its preparation jobs on first use. */
export const ensure = mutation({
  args: { calendarEntryId: v.id('calendarEntries') },
  returns: v.object({ meetingId: v.id('meetings') }),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const entry = await entryFor(ctx, workspace._id, args.calendarEntryId);
    await assertTokenCap(ctx, workspace);
    return { meetingId: await ensureMeeting(ctx, entry) };
  },
});

/** A workspace member opens the boardroom; the meeting and its calendar entry go live. */
export const open = mutation({
  args: { meetingId: v.id('meetings') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const { meeting, entry } = await meetingFor(ctx, workspace._id, args.meetingId);
    if (meeting.status === 'closing' || meeting.status === 'closed')
      throw new Error('Meeting is already closed');
    if (meeting.status !== 'live')
      await ctx.db.patch(meeting._id, {
        status: 'live',
        openedBy: actor.subject,
        openedAt: Date.now(),
      });
    if (entry.status === 'scheduled')
      await ctx.db.patch(entry._id, { status: 'live', updatedAt: Date.now() });
    return null;
  },
});

/**
 * A person asks a question of named attendees, or of everyone when none are named. Each addressed
 * employee answers on its own meeting session through one `meeting_answer` job.
 */
export const ask = mutation({
  args: {
    meetingId: v.id('meetings'),
    text: v.string(),
    addressedTo: v.optional(v.array(v.id('installations'))),
  },
  returns: v.object({ turnId: v.id('meetingTurns') }),
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const { meeting, entry, attendees } = await meetingFor(ctx, workspace._id, args.meetingId);
    if (meeting.status !== 'live') throw new Error('Open the meeting before asking a question');
    if (!attendees.length) throw new Error('This meeting has no employee attendees');
    await assertTokenCap(ctx, workspace);
    const named = [...new Set(args.addressedTo ?? [])];
    const addressed = named.length
      ? named.map((id) => {
          const attendee = attendees.find((one) => one._id === id);
          if (!attendee) throw new Error('A question can only address attendees of this meeting');
          return attendee;
        })
      : attendees;
    const turnId = await ctx.db.insert('meetingTurns', {
      workspaceId: workspace._id,
      meetingId: meeting._id,
      kind: 'question',
      authorSubject: actor.subject,
      authorName: actor.name,
      ...(named.length ? { addressedTo: addressed.map((one) => one._id) } : {}),
      text: cleanText(args.text, 'Question', 5_000),
      createdAt: Date.now(),
    });
    for (const attendee of addressed) {
      const taskId = await meetingTaskFor(ctx, meeting, entry, attendee);
      await insertJob(ctx, {
        workspaceId: workspace._id,
        taskId,
        uniqueKey: `meeting_answer:${turnId}:${attendee._id}`,
        kind: 'meeting_answer',
        payload: JSON.stringify({ meetingId: meeting._id, turnId, employeeId: attendee._id }),
      });
    }
    return { turnId };
  },
});

/** Closing runs one wrap-up turn per attendee; `finalize` closes the meeting once they land. */
export const close = mutation({
  args: { meetingId: v.id('meetings') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const { meeting, entry, attendees } = await meetingFor(ctx, workspace._id, args.meetingId);
    if (meeting.status === 'closed') throw new Error('Meeting is already closed');
    await ctx.db.patch(meeting._id, { status: 'closing' });
    for (const attendee of attendees) {
      const taskId = await meetingTaskFor(ctx, meeting, entry, attendee);
      await insertJob(ctx, {
        workspaceId: workspace._id,
        taskId,
        uniqueKey: `meeting_wrapup:${meeting._id}:${attendee._id}`,
        kind: 'meeting_wrapup',
        payload: JSON.stringify({ meetingId: meeting._id, employeeId: attendee._id }),
      });
    }
    return null;
  },
});

/**
 * Closes the meeting once every wrap-up job has landed, and completes the hidden meeting tasks so
 * their sessions stop being claimable.
 */
export const finalize = mutation({
  args: { meetingId: v.id('meetings') },
  returns: v.object({ closed: v.boolean() }),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const { meeting, entry, attendees } = await meetingFor(ctx, workspace._id, args.meetingId);
    if (meeting.status === 'closed') return { closed: true };
    if (meeting.status !== 'closing') throw new Error('Close the meeting first');
    const wrapups = await Promise.all(
      attendees.map((attendee) =>
        ctx.db
          .query('jobs')
          .withIndex('by_unique_key', (q) =>
            q.eq('uniqueKey', `meeting_wrapup:${meeting._id}:${attendee._id}`),
          )
          .unique(),
      ),
    );
    // A failed wrap-up has landed as far as the meeting is concerned; the job carries the error.
    if (wrapups.some((job) => !job || job.state === 'queued' || job.state === 'leased'))
      return { closed: false };
    const now = Date.now();
    await ctx.db.patch(meeting._id, { status: 'closed', closedAt: now });
    if (entry.status !== 'cancelled') await ctx.db.patch(entry._id, { status: 'done', updatedAt: now });
    for (const job of wrapups) {
      if (!job) continue;
      const task = await ctx.db.get(job.taskId);
      if (task && !['completed', 'failed', 'cancelled'].includes(task.status))
        await ctx.db.patch(task._id, { status: 'completed', updatedAt: now });
    }
    return { closed: true };
  },
});

async function proposedOutcome(ctx: MutationCtx, workspaceId: Id<'workspaces'>, turnId: Id<'meetingTurns'>) {
  const turn = await ctx.db.get(turnId);
  if (!turn || turn.workspaceId !== workspaceId || !turn.outcome) throw new Error('Outcome not found');
  if (turn.outcome.status !== 'proposed') throw new Error('This outcome was already decided');
  return { turn, outcome: turn.outcome };
}

/**
 * A person confirms a proposed outcome. A task outcome starts the task, a deadline outcome moves a
 * task's deadline, and a meeting outcome is returned for the calendar to schedule.
 */
export const confirmOutcome = mutation({
  args: { turnId: v.id('meetingTurns') },
  handler: async (ctx, args) => {
    const { workspace, actor } = await requireWorkspace(ctx);
    const { turn, outcome } = await proposedOutcome(ctx, workspace._id, args.turnId);
    const payload = parseOutcomePayload(outcome.kind, outcome.payload);
    await ctx.db.patch(turn._id, { outcome: { ...outcome, status: 'confirmed' } });
    if (payload.kind === 'task') {
      await assertTokenCap(ctx, workspace);
      const { installation, version } = await assertEmployeeReady(
        ctx,
        workspace,
        actor.subject,
        payload.employeeId,
      );
      const taskId = await startTask(ctx, {
        workspace,
        createdBy: actor.subject,
        createdByName: actor.name,
        employeeId: installation._id,
        version,
        title: payload.title,
        prompt: payload.prompt,
        floor: installation.floorId
          ? await assignmentForFloor(ctx, workspace._id, installation.floorId, installation._id)
          : undefined,
      });
      return { taskId };
    }
    if (payload.kind === 'deadline') {
      const task = await ctx.db.get(payload.taskId);
      if (!task || task.workspaceId !== workspace._id) throw new Error('Task not found');
      await ctx.db.patch(task._id, { deadlineAt: payload.deadlineAt, updatedAt: Date.now() });
      return { taskId: task._id };
    }
    // A confirmed next meeting is booked through the calendar, on the same floor or project.
    if (payload.kind === 'meeting') {
      const { entry } = await meetingFor(ctx, workspace._id, turn.meetingId);
      const entryId = await createMeetingEntry(ctx, workspace, actor, {
        title: payload.title,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        projectId: entry.projectId,
        floorId: entry.floorId,
        attendees: payload.attendees.map((id) => ({ kind: 'employee' as const, id, name: '' })),
        agenda: payload.agenda,
        purpose: payload.purpose,
      });
      return { entryId };
    }
    return {};
  },
});

/** A person dismisses a proposed outcome; nothing else happens. */
export const dismissOutcome = mutation({
  args: { turnId: v.id('meetingTurns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const { turn, outcome } = await proposedOutcome(ctx, workspace._id, args.turnId);
    await ctx.db.patch(turn._id, { outcome: { ...outcome, status: 'dismissed' } });
    return null;
  },
});
