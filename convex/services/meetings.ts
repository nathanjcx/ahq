import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { mutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import {
  addMeetingUsage,
  employeeName,
  employeeWork,
  meetingContext,
  meetingTurns,
  ownReport,
  parseOutcomePayload,
  transcriptText,
  turnInputs,
  workText,
  TRANSCRIPT_LIMIT,
} from '../lib/meetings';
import { tokenUsage } from '../schema';
import { cleanText, requireService, untrustedBlock } from '../shared';

const outcomeKind = v.union(
  v.literal('task'),
  v.literal('deadline'),
  v.literal('meeting'),
  v.literal('note'),
);

/** The attendee's own row and name, checked against the meeting before any turn is written. */
async function attendeeFor(ctx: MutationCtx, meetingId: Id<'meetings'>, employeeId: Id<'installations'>) {
  const { meeting, attendees } = await meetingContext(ctx, meetingId);
  const attendee = attendees.find((one) => one._id === employeeId);
  if (!attendee) throw new Error('Employee is not an attendee of this meeting');
  const turns = await meetingTurns(ctx, meetingId);
  return { meeting, attendees, turns, name: await employeeName(ctx, attendee) };
}

/** What a preparation turn reads: the agenda, the attendees, and that employee's recent work. */
export const prepInputs = query({
  args: { secret: v.string(), meetingId: v.id('meetings'), employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { inputs } = await turnInputs(ctx, args.meetingId, args.employeeId);
    const work = await employeeWork(ctx, args.employeeId, 10);
    const rendered = workText(work);
    return { ...inputs, recentWork: rendered ? untrustedBlock(rendered) : undefined };
  },
});

/** The employee's preparation report. The meeting is ready once every attendee has reported. */
export const recordReport = mutation({
  args: {
    secret: v.string(),
    meetingId: v.id('meetings'),
    employeeId: v.id('installations'),
    text: v.string(),
  },
  returns: v.object({ turnId: v.id('meetingTurns') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { meeting, attendees, turns, name } = await attendeeFor(ctx, args.meetingId, args.employeeId);
    const existing = turns.find((turn) => turn.kind === 'report' && turn.employeeId === args.employeeId);
    if (existing) return { turnId: existing._id };
    const turnId = await ctx.db.insert('meetingTurns', {
      workspaceId: meeting.workspaceId,
      meetingId: meeting._id,
      kind: 'report',
      employeeId: args.employeeId,
      authorName: name,
      text: cleanText(args.text, 'Report', 20_000),
      createdAt: Date.now(),
    });
    const reported = new Set(
      turns.filter((turn) => turn.kind === 'report').map((turn) => String(turn.employeeId)),
    );
    reported.add(String(args.employeeId));
    if (meeting.status === 'preparing' && attendees.every((one) => reported.has(String(one._id))))
      await ctx.db.patch(meeting._id, { status: 'ready' });
    return { turnId };
  },
});

/** What an answer turn reads: the question, the transcript so far, and the employee's own report. */
export const answerInputs = query({
  args: {
    secret: v.string(),
    meetingId: v.id('meetings'),
    turnId: v.id('meetingTurns'),
    employeeId: v.id('installations'),
  },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { inputs, turns } = await turnInputs(ctx, args.meetingId, args.employeeId);
    const question = turns.find((turn) => turn._id === args.turnId);
    if (!question || question.kind !== 'question' || question.meetingId !== args.meetingId)
      throw new Error('Question not found');
    if (question.addressedTo && !question.addressedTo.includes(args.employeeId))
      throw new Error('This question was not addressed to this employee');
    const transcript = transcriptText(
      turns.filter((turn) => turn.createdAt <= question.createdAt),
      TRANSCRIPT_LIMIT,
    );
    return {
      ...inputs,
      question: question.text,
      askedBy: question.authorName,
      // A question put to everyone gets a short answer; an addressed one gets the full turn.
      everyone: !question.addressedTo,
      transcript: transcript ? untrustedBlock(transcript) : undefined,
      report: ownReport(turns, args.employeeId),
    };
  },
});

/** One attendee's answer, in reply to the question turn, with the tokens it cost. */
export const recordAnswer = mutation({
  args: {
    secret: v.string(),
    meetingId: v.id('meetings'),
    turnId: v.id('meetingTurns'),
    employeeId: v.id('installations'),
    text: v.string(),
    usage: v.optional(tokenUsage),
  },
  returns: v.object({ turnId: v.id('meetingTurns') }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { meeting, turns, name } = await attendeeFor(ctx, args.meetingId, args.employeeId);
    const question = turns.find((turn) => turn._id === args.turnId);
    if (!question || question.kind !== 'question') throw new Error('Question not found');
    const existing = turns.find(
      (turn) =>
        turn.kind === 'answer' && turn.inReplyTo === args.turnId && turn.employeeId === args.employeeId,
    );
    if (existing) return { turnId: existing._id };
    const turnId = await ctx.db.insert('meetingTurns', {
      workspaceId: meeting.workspaceId,
      meetingId: meeting._id,
      kind: 'answer',
      employeeId: args.employeeId,
      authorName: name,
      inReplyTo: args.turnId,
      text: cleanText(args.text, 'Answer', 20_000),
      // What this answer cost, so the boardroom can price the question rather than the whole meeting.
      ...(args.usage ? { usage: args.usage } : {}),
      createdAt: Date.now(),
    });
    if (args.usage) await addMeetingUsage(ctx, meeting, args.usage);
    return { turnId };
  },
});

/** What a wrap-up turn reads: the whole transcript, the employee's report, and its open tasks. */
export const wrapupInputs = query({
  args: { secret: v.string(), meetingId: v.id('meetings'), employeeId: v.id('installations') },
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { inputs, turns } = await turnInputs(ctx, args.meetingId, args.employeeId);
    const transcript = transcriptText(turns, TRANSCRIPT_LIMIT);
    const { tasks } = await employeeWork(ctx, args.employeeId, 20);
    return {
      ...inputs,
      transcript: transcript ? untrustedBlock(transcript) : undefined,
      report: ownReport(turns, args.employeeId),
      openTasks: tasks
        .filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
        .map((task) => ({
          id: task._id,
          title: task.title,
          status: task.status,
          deadlineAt: task.deadlineAt,
        })),
    };
  },
});

/** The wrap-up's proposals. Every payload is validated here and again when a person confirms it. */
export const recordOutcomes = mutation({
  args: {
    secret: v.string(),
    meetingId: v.id('meetings'),
    employeeId: v.id('installations'),
    outcomes: v.array(v.object({ kind: outcomeKind, payload: v.string(), text: v.string() })),
  },
  returns: v.object({ turnIds: v.array(v.id('meetingTurns')) }),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const { meeting, turns, name } = await attendeeFor(ctx, args.meetingId, args.employeeId);
    const already = turns.filter((turn) => turn.kind === 'outcome' && turn.employeeId === args.employeeId);
    if (already.length) return { turnIds: already.map((turn) => turn._id) };
    const turnIds: Id<'meetingTurns'>[] = [];
    for (const outcome of args.outcomes.slice(0, 20)) {
      parseOutcomePayload(outcome.kind, outcome.payload);
      turnIds.push(
        await ctx.db.insert('meetingTurns', {
          workspaceId: meeting.workspaceId,
          meetingId: meeting._id,
          kind: 'outcome',
          employeeId: args.employeeId,
          authorName: name,
          text: cleanText(outcome.text, 'Outcome', 2_000),
          outcome: { kind: outcome.kind, payload: outcome.payload, status: 'proposed' },
          createdAt: Date.now(),
        }),
      );
    }
    return { turnIds };
  },
});

/** Tokens a prep or wrap-up turn cost, added to the meeting total. */
export const meetingUsage = mutation({
  args: { secret: v.string(), meetingId: v.id('meetings'), usage: tokenUsage },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireService(args.secret);
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error('Meeting not found');
    await addMeetingUsage(ctx, meeting, args.usage);
    return null;
  },
});
