import { describe, expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import { defaultWorkspaceSettings } from '../lib/contracts';
import { harness, identity as orgIdentity, publishEmployee, secret, type Harness } from './support';

const HOUR = 3_600_000;
const DAY = 86_400_000;

async function workspace(t: Harness) {
  const { versionId } = await publishEmployee(t);
  const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await owner.mutation(api.marketplace.hire, { versionId });
  await owner.mutation(api.schedule.updateSettings, {
    ...defaultWorkspaceSettings,
    timezone: 'UTC',
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    startHour: 0,
    endHour: 24,
    attendedStartHour: 0,
    attendedEndHour: 24,
  });
  const { taskId } = await owner.mutation(api.tasks.create, {
    employeeId,
    title: 'Ship the launch page',
    prompt: 'Move the work forward and report at the end of the shift.',
  });
  return { owner, employeeId, taskId };
}

describe('meetings', () => {
  it('books, changes, and cancels a meeting, and shows it on the calendar', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const startsAt = Date.now() + 2 * HOUR;
    const { entryId } = await owner.mutation(api.calendar.createMeeting, {
      title: 'Launch review',
      startsAt,
      endsAt: startsAt + HOUR,
      attendees: [
        { kind: 'employee', id: employeeId, name: 'ignored, the workspace names its own' },
        { kind: 'person', id: 'owner', name: 'Ada' },
      ],
      agenda: ['Where the page stands'],
      purpose: 'Decide whether to ship on Friday.',
    });
    const entries = await owner.query(api.calendar.entries, {
      from: Date.now() - HOUR,
      to: Date.now() + DAY,
    });
    expect(entries.filter((entry) => entry.kind === 'meeting')).toEqual([
      expect.objectContaining({
        id: entryId,
        title: 'Launch review',
        status: 'scheduled',
        agenda: ['Where the page stands'],
        attendees: [
          { kind: 'employee', id: employeeId, name: 'Operations analyst' },
          { kind: 'person', id: 'owner', name: 'Ada' },
        ],
      }),
    ]);

    await owner.mutation(api.calendar.updateMeeting, {
      entryId,
      title: 'Launch go or no go',
      startsAt,
      endsAt: startsAt + 2 * HOUR,
      attendees: [{ kind: 'employee', id: employeeId, name: 'Operations analyst' }],
      agenda: [],
    });
    await owner.mutation(api.calendar.cancelMeeting, { entryId });
    expect(
      (await owner.query(api.calendar.entries, { from: Date.now() - HOUR, to: Date.now() + DAY }))
        .filter((entry) => entry.kind === 'meeting')
        .map((entry) => [entry.title, entry.status]),
    ).toEqual([['Launch go or no go', 'cancelled']]);
    await expect(
      owner.mutation(api.calendar.updateMeeting, {
        entryId,
        title: 'Launch go or no go',
        startsAt,
        endsAt: startsAt + HOUR,
        attendees: [],
        agenda: [],
      }),
    ).rejects.toThrow('can no longer be changed');
  });

  it('refuses a time or an attendee it cannot stand behind', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const startsAt = Date.now() + HOUR;
    const book = (patch: Record<string, unknown>) =>
      owner.mutation(api.calendar.createMeeting, {
        title: 'Launch review',
        startsAt,
        endsAt: startsAt + HOUR,
        attendees: [],
        agenda: [],
        ...patch,
      });
    await expect(book({ endsAt: startsAt })).rejects.toThrow('must end after it starts');
    await expect(book({ endsAt: startsAt + 20 * HOUR })).rejects.toThrow('cannot run longer');
    await expect(
      book({ startsAt: startsAt + 900 * DAY, endsAt: startsAt + 900 * DAY + HOUR }),
    ).rejects.toThrow('too far from today');
    await expect(
      book({
        attendees: [
          { kind: 'employee', id: employeeId, name: 'One' },
          { kind: 'employee', id: employeeId, name: 'Again' },
        ],
      }),
    ).rejects.toThrow('listed twice');
    const outsider = t.withIdentity(orgIdentity('outsider', 'other', 'org:admin'));
    await outsider.mutation(api.workspace.bootstrap, { name: 'Other' });
    await expect(
      outsider.mutation(api.calendar.createMeeting, {
        title: 'Poaching',
        startsAt,
        endsAt: startsAt + HOUR,
        attendees: [{ kind: 'employee', id: employeeId, name: 'Theirs' }],
        agenda: [],
      }),
    ).rejects.toThrow('Employee not found');
  });
});

describe('the derived calendar', () => {
  it('shows deadlines, shifts, and the nightly audit beside the meetings', async () => {
    const t = harness();
    const { owner, employeeId, taskId } = await workspace(t);
    const deadlineAt = Date.now() + 6 * HOUR;
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { deadlineAt });
      const job = (await ctx.db.query('jobs').first())!;
      await ctx.db.patch(job._id, {
        state: 'leased',
        leaseOwner: 'worker-1',
        leaseToken: 'lease-1',
        leaseExpiresAt: Date.now() + 60_000,
      });
    });
    await t.mutation(api.services.schedule.startShift, {
      secret,
      taskId,
      leaseToken: 'lease-1',
      model: 'gpt-5.6-terra',
      kind: 'work',
    });
    const entries = await owner.query(api.calendar.entries, {
      from: Date.now() - HOUR,
      to: Date.now() + DAY,
    });
    expect(entries.filter((entry) => entry.kind === 'deadline')).toEqual([
      expect.objectContaining({ id: `deadline:${taskId}`, startsAt: deadlineAt, taskId }),
    ]);
    expect(entries.filter((entry) => entry.kind === 'shift')).toEqual([
      expect.objectContaining({
        taskId,
        status: 'live',
        attendees: [{ kind: 'employee', id: employeeId, name: 'Operations analyst' }],
      }),
    ]);
    // An auditor makes the night visible; without one the calendar says nothing about it.
    expect(entries.filter((entry) => entry.kind === 'audit')).toEqual([]);
  });

  it('refuses a range that does not end after it starts', async () => {
    const t = harness();
    const { owner } = await workspace(t);
    await expect(owner.query(api.calendar.entries, { from: 10, to: 10 })).rejects.toThrow(
      'must end after it starts',
    );
  });
});

describe('the suggested agenda', () => {
  it('gathers what is due, what is behind, and what is open', async () => {
    const t = harness();
    const { owner, employeeId, taskId } = await workspace(t);
    const startsAt = Date.now() + 2 * HOUR;
    await t.run(async (ctx) => {
      const workspaceId = (await ctx.db.query('workspaces').first())!._id;
      await ctx.db.patch(taskId, { deadlineAt: startsAt - HOUR });
      await ctx.db.insert('reports', {
        workspaceId,
        taskId,
        employeeId,
        done: [],
        inProgress: [],
        blockedOn: [],
        next: [],
        risks: [],
        deadlineConfidence: 0.1,
        inferred: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert('memories', {
        workspaceId,
        scope: 'workspace',
        scopeId: '',
        kind: 'fact',
        text: 'The launch date is the ninth',
        tags: [],
        author: 'agent',
        authorName: 'Operations analyst',
        confidence: 0.4,
        status: 'contested',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('auditFindings', {
        workspaceId,
        employeeId,
        auditDate: '2026-09-11',
        severity: 'high',
        claim: 'The report claims tests that do not exist',
        evidence: 'No test run in the journal',
        requiredAction: 'Write the test or withdraw the claim',
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('alerts', {
        workspaceId,
        source: 'webhook',
        fingerprint: 'checkout-500',
        severity: 'critical',
        title: 'Checkout is failing',
        detail: 'Five hundreds on checkout.',
        status: 'open',
        affectedFloorIds: [],
        occurrences: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const suggestions = await owner.query(api.calendar.suggestAgenda, { startsAt });
    expect(suggestions.map((one) => one.reason).sort()).toEqual([
      'alert',
      'behind',
      'contested',
      'deadline',
      'finding',
    ]);
    expect(suggestions.find((one) => one.reason === 'deadline')).toMatchObject({ refId: taskId });
  });
});
