import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { harness, identity as orgIdentity, publishEmployee, secret, type Harness } from './support';

/** A workspace with two employees on one floor and a scheduled meeting between them. */
async function boardroom(t: Harness) {
  const [{ versionId }, { versionId: secondVersionId }] = await Promise.all([
    publishEmployee(t),
    publishEmployee(t, { name: 'Writer' }),
  ]);
  const owner = t.withIdentity(orgIdentity('owner', 'acme'));
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await owner.mutation(api.marketplace.hire, { versionId });
  const { employeeId: writerId } = await owner.mutation(api.marketplace.hire, {
    versionId: secondVersionId,
  });
  const { floorId } = await owner.mutation(api.floors.create, {
    name: 'Launch',
    brief: 'Prepare the launch.',
    employeeIds: [employeeId, writerId],
  });
  const calendarEntryId = await t.run(async (ctx) => {
    await ctx.db.patch(employeeId, { floorId });
    await ctx.db.patch(writerId, { floorId });
    const workspace = await ctx.db.get(floorId);
    return ctx.db.insert('calendarEntries', {
      workspaceId: workspace!.workspaceId,
      kind: 'meeting' as const,
      title: 'Launch review',
      startsAt: 1_000,
      endsAt: 2_000,
      floorId,
      attendees: [
        { kind: 'employee' as const, id: employeeId, name: 'Operations analyst' },
        { kind: 'employee' as const, id: writerId, name: 'Writer' },
      ],
      agenda: ['Launch readiness'],
      purpose: 'Decide what ships.',
      status: 'scheduled' as const,
      createdBy: 'owner',
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return { owner, employeeId, writerId, floorId, calendarEntryId };
}

async function jobsOfKind(t: Harness, kind: string) {
  return t.run(async (ctx) => {
    const jobs = await ctx.db.query('jobs').collect();
    return jobs.filter((job) => job.kind === kind);
  });
}

describe('meetings', () => {
  it('prepares, runs, and closes a meeting on one session per attendee', async () => {
    const t = harness();
    const { owner, employeeId, writerId, calendarEntryId } = await boardroom(t);

    const { meetingId } = await owner.mutation(api.meetings.ensure, { calendarEntryId });
    // Ensuring again is idempotent: the same meeting, the same hidden tasks, the same prep jobs.
    expect(await owner.mutation(api.meetings.ensure, { calendarEntryId })).toEqual({ meetingId });
    const prep = await jobsOfKind(t, 'meeting_prep');
    expect(prep).toHaveLength(2);
    const tasks = await t.run(async (ctx) => ctx.db.query('tasks').collect());
    expect(tasks.map((task) => [task.title, task.visibility, task.cadence, task.status])).toEqual([
      ['Meeting: Launch review', 'workspace', 'once', 'queued'],
      ['Meeting: Launch review', 'workspace', 'once', 'queued'],
    ]);
    expect(new Set(tasks.map((task) => task.employeeId))).toEqual(new Set([employeeId, writerId]));

    await t.mutation(api.services.meetings.recordReport, {
      secret,
      meetingId,
      employeeId,
      text: 'Launch checklist is complete.',
    });
    expect((await owner.query(api.meetings.get, { calendarEntryId }))?.status).toBe('preparing');
    await t.mutation(api.services.meetings.recordReport, {
      secret,
      meetingId,
      employeeId: writerId,
      text: 'Copy is drafted.',
    });
    expect((await owner.query(api.meetings.get, { calendarEntryId }))?.status).toBe('ready');

    await expect(owner.mutation(api.meetings.ask, { meetingId, text: 'Are we ready?' })).rejects.toThrow(
      'Open the meeting',
    );
    await owner.mutation(api.meetings.open, { meetingId });
    const { turnId } = await owner.mutation(api.meetings.ask, {
      meetingId,
      text: 'What is left on copy?',
      addressedTo: [writerId],
    });
    const addressed = await jobsOfKind(t, 'meeting_answer');
    expect(addressed).toHaveLength(1);
    expect(JSON.parse(addressed[0].payload)).toEqual({ meetingId, turnId, employeeId: writerId });
    expect(addressed[0].taskId).toBe(tasks.find((task) => task.employeeId === writerId)!._id);

    const inputs = await t.query(api.services.meetings.answerInputs, {
      secret,
      meetingId,
      turnId,
      employeeId: writerId,
    });
    expect(inputs.question).toBe('What is left on copy?');
    expect(inputs.everyone).toBe(false);
    expect(inputs.report).toContain('Copy is drafted.');
    expect(inputs.transcript).toContain('Launch checklist is complete.');
    await expect(
      t.query(api.services.meetings.answerInputs, { secret, meetingId, turnId, employeeId }),
    ).rejects.toThrow('not addressed to this employee');

    await t.mutation(api.services.meetings.recordAnswer, {
      secret,
      meetingId,
      turnId,
      employeeId: writerId,
      text: 'One headline is open.',
      usage: { input: 100, cached: 10, output: 20 },
    });
    const everyone = await owner.mutation(api.meetings.ask, { meetingId, text: 'Any risks?' });
    expect(await jobsOfKind(t, 'meeting_answer')).toHaveLength(3);
    for (const attendee of [employeeId, writerId])
      await t.mutation(api.services.meetings.recordAnswer, {
        secret,
        meetingId,
        turnId: everyone.turnId,
        employeeId: attendee,
        text: 'No new risks.',
        usage: { input: 50, cached: 0, output: 10 },
      });

    const meeting = await owner.query(api.meetings.get, { calendarEntryId });
    expect(meeting?.usage).toEqual({ input: 200, cached: 10, output: 40 });
    expect(meeting?.turns.map((turn) => turn.kind)).toEqual([
      'report',
      'report',
      'question',
      'answer',
      'question',
      'answer',
      'answer',
    ]);
    expect(meeting?.turns.filter((turn) => turn.kind === 'answer').map((turn) => turn.inReplyTo)).toEqual([
      turnId,
      everyone.turnId,
      everyone.turnId,
    ]);
  });

  it('wraps up into outcomes a person confirms, then closes', async () => {
    const t = harness();
    const { owner, employeeId, writerId, calendarEntryId } = await boardroom(t);
    const { meetingId } = await owner.mutation(api.meetings.ensure, { calendarEntryId });
    await owner.mutation(api.meetings.open, { meetingId });
    await owner.mutation(api.meetings.close, { meetingId });
    const wrapups = await jobsOfKind(t, 'meeting_wrapup');
    expect(wrapups).toHaveLength(2);
    expect(JSON.parse(wrapups[0].payload).meetingId).toBe(meetingId);
    expect(await owner.mutation(api.meetings.finalize, { meetingId })).toEqual({ closed: false });

    await expect(
      t.mutation(api.services.meetings.recordOutcomes, {
        secret,
        meetingId,
        employeeId,
        outcomes: [{ kind: 'task', payload: JSON.stringify({ title: 'Fix' }), text: 'Fix the page' }],
      }),
    ).rejects.toThrow('Outcome prompt is required');
    await t.mutation(api.services.meetings.recordOutcomes, {
      secret,
      meetingId,
      employeeId,
      outcomes: [
        {
          kind: 'task',
          payload: JSON.stringify({
            title: 'Rewrite the headline',
            prompt: 'Rewrite it.',
            employeeId: writerId,
          }),
          text: 'Rewrite the headline',
        },
        { kind: 'note', payload: JSON.stringify({ text: 'Nothing else' }), text: 'Nothing else' },
      ],
    });
    await t.mutation(api.services.meetings.recordOutcomes, {
      secret,
      meetingId,
      employeeId: writerId,
      outcomes: [],
    });

    const outcomes = (await owner.query(api.meetings.get, { calendarEntryId }))!.turns.filter(
      (turn) => turn.kind === 'outcome',
    );
    expect(outcomes.map((turn) => turn.outcome?.status)).toEqual(['proposed', 'proposed']);
    const { taskId } = await owner.mutation(api.meetings.confirmOutcome, { turnId: outcomes[0].id });
    expect(taskId).toBeDefined();
    const created = await t.run(async (ctx) => ctx.db.get(taskId as Id<'tasks'>));
    expect(created).toMatchObject({ title: 'Rewrite the headline', employeeId: writerId });
    await expect(owner.mutation(api.meetings.confirmOutcome, { turnId: outcomes[0].id })).rejects.toThrow(
      'already decided',
    );
    await owner.mutation(api.meetings.dismissOutcome, { turnId: outcomes[1].id });

    await t.run(async (ctx) => {
      for (const job of await ctx.db.query('jobs').collect())
        if (job.kind === 'meeting_wrapup') await ctx.db.patch(job._id, { state: 'completed' });
    });
    expect(await owner.mutation(api.meetings.finalize, { meetingId })).toEqual({ closed: true });
    const closed = await owner.query(api.meetings.get, { calendarEntryId });
    expect(closed?.status).toBe('closed');
    const entry = await t.run(async (ctx) => ctx.db.get(calendarEntryId));
    expect(entry?.status).toBe('done');
    const meetingTasks: Doc<'tasks'>[] = await t.run(async (ctx) =>
      (await ctx.db.query('tasks').collect()).filter((task) => task.title.startsWith('Meeting:')),
    );
    expect(meetingTasks.map((task) => task.status)).toEqual(['completed', 'completed']);
  });

  it('keeps meetings inside their workspace', async () => {
    const t = harness();
    const { owner, calendarEntryId } = await boardroom(t);
    const { meetingId } = await owner.mutation(api.meetings.ensure, { calendarEntryId });
    const outsider = t.withIdentity(orgIdentity('outsider', 'other'));
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    await expect(outsider.query(api.meetings.get, { calendarEntryId })).rejects.toThrow(
      'Calendar entry not found',
    );
    await expect(outsider.mutation(api.meetings.ensure, { calendarEntryId })).rejects.toThrow(
      'Calendar entry not found',
    );
    await expect(outsider.mutation(api.meetings.open, { meetingId })).rejects.toThrow('Meeting not found');
  });
});
