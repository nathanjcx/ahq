import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { defaultWorkspaceSettings, type WorkspaceSettings } from '../lib/contracts';
import { harness, hireOne, identity as orgIdentity, publishEmployee, secret, type Harness } from './support';

type SettingsArgs = Omit<WorkspaceSettings, 'updatedAt'>;
/** The harness as one signed-in person sees it. */
type Caller = ReturnType<Harness['withIdentity']>;
/** Hours that cover the whole week, so a test never depends on when it runs. */
const alwaysWorking: SettingsArgs = {
  ...defaultWorkspaceSettings,
  timezone: 'UTC',
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  startHour: 0,
  endHour: 24,
  attendedStartHour: 0,
  attendedEndHour: 24,
};
/** Every day but today, so the workspace is reliably after hours. */
function afterHours(extra: Partial<SettingsArgs> = {}): SettingsArgs {
  const today = new Date().getUTCDay();
  return {
    ...alwaysWorking,
    workingDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== today),
    ...extra,
  };
}

async function workspace(t: Harness, settings: SettingsArgs = alwaysWorking) {
  const { versionId, listingId } = await publishEmployee(t);
  const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
  await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { employeeId } = await hireOne(owner, listingId);
  const colleagueVersion = await publishEmployee(t, { name: 'Copy editor' });
  const second = await hireOne(owner, colleagueVersion.listingId);
  await owner.mutation(api.schedule.updateSettings, settings);
  return { owner, employeeId, colleagueId: second.employeeId, versionId };
}

/** A daily task, as the projects workstream will create it. */
async function dailyTask(t: Harness, owner: Caller, employeeId: Id<'installations'>, title: string) {
  const { taskId } = await owner.mutation(api.tasks.create, {
    employeeId,
    title,
    prompt: 'Move the work forward and report at the end of the shift.',
  });
  await t.run(async (ctx) => ctx.db.patch(taskId, { cadence: 'daily' }));
  return taskId;
}

async function jobsOfKind(t: Harness, kind: string) {
  return t.run(async (ctx) => (await ctx.db.query('jobs').collect()).filter((job) => job.kind === kind));
}

describe('workspace settings', () => {
  it('answers with the defaults before anybody saves them, then with what was saved', async () => {
    const t = harness();
    const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    expect(await owner.query(api.schedule.settings, {})).toMatchObject({
      timezone: 'UTC',
      startHour: 9,
      endHour: 18,
      overnightPolicy: 'audits_only',
    });
    await owner.mutation(api.schedule.updateSettings, {
      ...defaultWorkspaceSettings,
      timezone: 'Europe/Berlin',
      startHour: 8,
      endHour: 17,
      attendedStartHour: 9,
      attendedEndHour: 16,
      overnightPolicy: 'cheap',
    });
    expect(await owner.query(api.schedule.settings, {})).toMatchObject({
      timezone: 'Europe/Berlin',
      startHour: 8,
      attendedEndHour: 16,
      overnightPolicy: 'cheap',
    });
  });

  it('refuses hours, zones, and rates that do not make sense', async () => {
    const t = harness();
    const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const save = (patch: Partial<SettingsArgs>) =>
      owner.mutation(api.schedule.updateSettings, {
        ...defaultWorkspaceSettings,
        timezone: 'UTC',
        ...patch,
      });
    await expect(save({ timezone: 'Mars/Olympus' })).rejects.toThrow('Unknown timezone');
    await expect(save({ startHour: 18, endHour: 9 })).rejects.toThrow('must end after it starts');
    await expect(save({ startHour: 9, endHour: 30 })).rejects.toThrow('must be an hour');
    await expect(save({ attendedStartHour: 7 })).rejects.toThrow('inside working hours');
    await expect(save({ workingDays: [] })).rejects.toThrow('at least one day');
    await expect(save({ dailyTokenCap: -1 })).rejects.toThrow('cannot be negative');
    await expect(save({ maxConcurrentInstances: 0 })).rejects.toThrow('at least one concurrent');
    await expect(save({ notificationChannels: ['carrier-pigeon'] })).rejects.toThrow('Unknown notification');
    await expect(
      save({ rates: [{ model: 'gpt-5.6-terra', input: -1, cached: 0, output: 0 }] }),
    ).rejects.toThrow('rate cannot be negative');
    await expect(save({ emergencyAllowList: ['merge_pull_request'] })).rejects.toThrow('unknown tool');
  });

  it('lets only an owner or an administrator save them', async () => {
    const t = harness();
    const owner = t.withIdentity(orgIdentity('owner', 'acme', 'org:admin'));
    await owner.mutation(api.workspace.bootstrap, { name: 'Acme' });
    const colleague = t.withIdentity(orgIdentity('colleague', 'acme'));
    await expect(
      colleague.mutation(api.schedule.updateSettings, { ...defaultWorkspaceSettings, timezone: 'UTC' }),
    ).rejects.toThrow('administrator access required');
  });
});

describe('the scheduler tick', () => {
  it('gives a daily task one shift job for the day and does not repeat it', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const taskId = await dailyTask(t, owner, employeeId, 'Ship the launch page');

    await t.mutation(internal.services.schedule.tick, {});
    const first = await jobsOfKind(t, 'start_shift');
    expect(first).toHaveLength(1);
    expect(first[0].taskId).toBe(taskId);
    expect(first[0].uniqueKey.startsWith(`shift:${taskId}:`)).toBe(true);

    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'start_shift')).toHaveLength(1);
    // Once the shift is open the planner sees it running and leaves the instance alone.
    const { date } = await startShift(t, taskId);
    await t.run(async (ctx) => {
      for (const job of await ctx.db.query('jobs').collect())
        if (job.kind === 'start_shift') await ctx.db.delete(job._id);
    });
    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'start_shift')).toHaveLength(0);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('waits on an unfinished dependency and reviews it instead', async () => {
    const t = harness();
    const { owner, employeeId, colleagueId } = await workspace(t);
    const first = await dailyTask(t, owner, employeeId, 'Write the copy');
    const second = await dailyTask(t, owner, colleagueId, 'Lay out the page');
    await t.run(async (ctx) => ctx.db.patch(second, { dependsOn: [first], status: 'waiting' }));

    await t.mutation(internal.services.schedule.tick, {});
    expect((await jobsOfKind(t, 'review_shift')).map((job) => job.taskId)).toEqual([second]);
    expect((await jobsOfKind(t, 'start_shift')).map((job) => job.taskId)).toEqual([first]);
  });

  it('stays quiet after hours unless the overnight policy is cheap', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t, afterHours());
    await dailyTask(t, owner, employeeId, 'Ship the launch page');
    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'start_shift')).toHaveLength(0);

    await owner.mutation(api.schedule.updateSettings, afterHours({ overnightPolicy: 'cheap' }));
    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'start_shift')).toHaveLength(1);
  });

  it('creates the reserved employees once and opens one standing session each', async () => {
    const t = harness();
    const { owner } = await workspace(t, afterHours());
    await t.mutation(internal.services.schedule.tick, {});
    const reserved = async () =>
      t.run(async (ctx) =>
        (await ctx.db.query('installations').collect())
          .filter((one) => one.kind && one.kind !== 'worker')
          .map((one) => one.kind),
      );
    expect([...(await reserved())].sort()).toEqual(['auditor', 'janitor', 'triage']);
    const sessions = async () =>
      t.run(async (ctx) =>
        (await ctx.db.query('tasks').collect())
          .filter((task) => task.kind === 'standing')
          .map((task) => task.title)
          .sort(),
      );
    expect(await sessions()).toEqual([
      'The Auditor standing session',
      'The Janitor standing session',
      'Triage standing session',
    ]);
    // Reserved instances and their sessions are the workspace's, not the marketplace's or the board's.
    expect(await owner.query(api.marketplace.list, {})).toHaveLength(2);
    expect((await owner.query(api.workspace.dashboard, {})).tasks).toEqual([]);
    expect(
      (await owner.query(api.workspace.dashboard, {})).employees
        .filter((one) => one.kind && one.kind !== 'worker')
        .map((one) => one.kind),
    ).toHaveLength(3);

    await t.mutation(internal.services.schedule.tick, {});
    expect(await reserved()).toHaveLength(3);
    expect(await sessions()).toHaveLength(3);
  });

  it('audits after hours in the night’s own task', async () => {
    const t = harness();
    await workspace(t, afterHours());
    await t.mutation(internal.services.schedule.tick, {});
    const audits = await jobsOfKind(t, 'audit_run');
    expect(audits).toHaveLength(1);
    const task = await t.run(async (ctx) => ctx.db.get(audits[0].taskId as Id<'tasks'>));
    expect(task).toMatchObject({ kind: 'audit', title: expect.stringContaining('Audit: ') });
    expect(JSON.parse(audits[0].payload)).toMatchObject({ date: task!.sessionKey });

    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'audit_run')).toHaveLength(1);
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query('tasks').collect()).filter((one) => one.kind === 'audit'),
      ),
    ).toHaveLength(1);
  });

  it('prepares a meeting at the lead, on the attendee’s own hidden session', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });
    await t.run(async (ctx) => ctx.db.patch(employeeId, { floorId }));
    const { entryId } = await owner.mutation(api.calendar.createMeeting, {
      title: 'Launch review',
      startsAt: Date.now() + 30 * 60_000,
      endsAt: Date.now() + 60 * 60_000,
      floorId,
      attendees: [{ kind: 'employee', id: employeeId, name: 'Operations analyst' }],
      agenda: ['Launch readiness'],
    });
    await t.mutation(internal.services.schedule.tick, {});
    const prep = await jobsOfKind(t, 'meeting_prep');
    expect(prep).toHaveLength(1);
    const task = await t.run(async (ctx) => ctx.db.get(prep[0].taskId as Id<'tasks'>));
    expect(task).toMatchObject({ kind: 'meeting', employeeId, title: 'Meeting: Launch review' });
    const meetingId = await t.run(
      async (ctx) =>
        (await ctx.db.query('meetings').collect()).find((one) => one.calendarEntryId === entryId)!._id,
    );
    expect(JSON.parse(prep[0].payload)).toMatchObject({ meetingId, employeeId });

    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'meeting_prep')).toHaveLength(1);
  });

  it('answers an open alert whatever the hour, and stops at the daily cap', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t, { ...alwaysWorking, dailyTokenCap: 1 });
    await t.run(async (ctx) => ctx.db.patch(employeeId, { kind: 'triage' }));
    const taskId = await dailyTask(t, owner, employeeId, 'Ship the launch page');
    await t.run(async (ctx) => {
      const workspaceId = (await ctx.db.query('workspaces').first())!._id;
      await ctx.db.insert('alerts', {
        workspaceId,
        source: 'manual',
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
      await ctx.db.insert('usageReports', {
        workspaceId,
        taskId,
        externalId: 'usage-1',
        model: 'gpt-5.6-terra',
        input: 5,
        cached: 0,
        output: 5,
        period: new Date().toISOString().slice(0, 7),
        createdAt: Date.now(),
      });
    });
    await t.mutation(internal.services.schedule.tick, {});
    expect(await jobsOfKind(t, 'triage_run')).toHaveLength(1);
    // The cap is spent, so the ordinary shift does not start.
    expect(await jobsOfKind(t, 'start_shift')).toHaveLength(0);
  });
});

/** Leases the task's newest job and opens a shift with it, the way the worker does. */
async function startShift(t: Harness, taskId: Id<'tasks'>, leaseToken = 'lease-1') {
  await t.run(async (ctx) => {
    const job = (await ctx.db.query('jobs').collect()).find((one) => one.taskId === taskId)!;
    await ctx.db.patch(job._id, {
      state: 'leased',
      leaseOwner: 'worker-1',
      leaseToken,
      leaseExpiresAt: Date.now() + 60_000,
    });
  });
  return t.mutation(api.services.schedule.startShift, {
    secret,
    taskId,
    leaseToken,
    model: 'gpt-5.6-terra',
    kind: 'work',
  });
}

describe('shifts and reports', () => {
  it('opens a shift only against a live lease', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const taskId = await dailyTask(t, owner, employeeId, 'Ship the launch page');
    await expect(
      t.mutation(api.services.schedule.startShift, {
        secret,
        taskId,
        leaseToken: 'not-a-lease',
        model: 'gpt-5.6-terra',
        kind: 'work',
      }),
    ).rejects.toThrow('lease is no longer valid');
    const { shiftId, date } = await startShift(t, taskId);
    const shift = await t.run(async (ctx) => ctx.db.get(shiftId));
    expect(shift).toMatchObject({ taskId, employeeId, date, kind: 'work' });
    expect(shift!.endedAt).toBeUndefined();
  });

  it('closes a shift with its report, or infers one from what the employee last said', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const taskId = await dailyTask(t, owner, employeeId, 'Ship the launch page');
    const { shiftId } = await startShift(t, taskId);
    await t.run(async (ctx) => {
      const task = (await ctx.db.get(taskId))!;
      await ctx.db.insert('messages', {
        workspaceId: task.workspaceId,
        taskId,
        externalId: 'assistant-1',
        role: 'assistant',
        text: 'Drafted the hero section and pushed it for review.',
        completed: true,
        createdAt: Date.now(),
      });
    });
    const { reportId } = await t.mutation(api.services.schedule.endShift, { secret, shiftId });
    const report = await t.run(async (ctx) => ctx.db.get(reportId!));
    expect(report).toMatchObject({
      inferred: true,
      done: ['Drafted the hero section and pushed it for review.'],
    });
    expect(await t.run(async (ctx) => (await ctx.db.get(shiftId))!.reportId)).toBe(reportId);

    // A second close is a no-op rather than a second report.
    const again = await t.mutation(api.services.schedule.endShift, { secret, shiftId });
    expect(again.reportId).toBe(reportId);
    expect(await t.run(async (ctx) => (await ctx.db.query('reports').collect()).length)).toBe(1);
  });

  it('posts the report to the floor and the project the task belongs to', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const { floorId } = await owner.mutation(api.floors.create, {
      name: 'Launch',
      brief: 'Prepare the launch.',
      employeeIds: [employeeId],
    });
    const { projectId } = await owner.mutation(api.projects.create, {
      name: 'Relaunch',
      brief: 'Ship the new site.',
      floorIds: [floorId],
    });
    const { taskId } = await owner.mutation(api.tasks.create, {
      floorId,
      employeeId,
      projectId,
      title: 'Ship the launch page',
      prompt: 'Move the work forward and report at the end of the shift.',
    });
    await t.run(async (ctx) => ctx.db.patch(taskId, { cadence: 'daily' }));
    const { shiftId } = await startShift(t, taskId);
    const { reportId } = await t.mutation(api.services.schedule.endShift, {
      secret,
      shiftId,
      report: {
        done: ['Hero section'],
        inProgress: [],
        blockedOn: [],
        next: ['Footer'],
        risks: [],
      },
    });

    for (const scope of [
      { kind: 'floor' as const, scopeId: floorId },
      { kind: 'project' as const, scopeId: projectId },
    ]) {
      const { channelId } = await owner.mutation(api.channels.open, scope);
      const reports = (await owner.query(api.channels.posts, { channelId })).filter(
        (post) => post.kind === 'report',
      );
      expect(reports).toHaveLength(1);
      expect(reports[0].text).toContain('Done: Hero section');
      expect(reports[0].text).toContain('Next: Footer');
    }
    // Posting the same report again is a no-op, whoever asks.
    await t.mutation(api.services.channels.postReport, { secret, taskId, reportId: reportId! });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query('posts').collect()).filter((post) => post.kind === 'report'),
      ),
    ).toHaveLength(2);
  });

  it('reads pacing from the employee’s own last report and the hours left', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t);
    const taskId = await dailyTask(t, owner, employeeId, 'Ship the launch page');
    expect(await t.query(api.services.schedule.pacing, { secret, taskId })).toMatchObject({
      pacing: 'unknown',
    });
    const { shiftId } = await startShift(t, taskId);
    await t.run(async (ctx) => ctx.db.patch(taskId, { deadlineAt: Date.now() + 3 * 86_400_000 }));
    await t.mutation(api.services.schedule.endShift, {
      secret,
      shiftId,
      report: {
        done: ['Hero section'],
        inProgress: ['Pricing table'],
        blockedOn: [],
        next: ['Footer'],
        risks: ['Copy is late'],
        deadlineConfidence: 0.2,
      },
    });
    const pacing = await t.query(api.services.schedule.pacing, { secret, taskId });
    expect(pacing.pacing).toBe('behind');
    expect(pacing.workingHoursLeft).toBeGreaterThan(0);
  });
});

describe('the day’s usage', () => {
  it('sums today’s reports for the summary, the dashboard, and the worker', async () => {
    const t = harness();
    const { owner, employeeId } = await workspace(t, { ...alwaysWorking, dailyTokenCap: 10_000 });
    const taskId = await dailyTask(t, owner, employeeId, 'Ship the launch page');
    const workspaceId = await t.run(async (ctx) => {
      const id = (await ctx.db.query('workspaces').first())!._id;
      for (const [externalId, createdAt] of [
        ['today', Date.now()],
        ['last-week', Date.now() - 8 * 86_400_000],
      ] as const)
        await ctx.db.insert('usageReports', {
          workspaceId: id,
          taskId,
          externalId,
          model: 'gpt-5.6-terra',
          input: 100,
          cached: 10,
          output: 20,
          period: new Date().toISOString().slice(0, 7),
          createdAt,
        });
      return id;
    });
    expect(await owner.query(api.schedule.summary, {})).toMatchObject({
      working: true,
      attended: true,
      usageToday: { input: 100, cached: 10, output: 20, cap: 10_000 },
    });
    expect(await t.query(api.services.schedule.dailyUsage, { secret, workspaceId })).toMatchObject({
      input: 100,
      output: 20,
      cap: 10_000,
    });
    expect((await owner.query(api.workspace.dashboard, {})).schedule).toMatchObject({
      working: true,
      usageToday: { input: 100, cap: 10_000 },
    });
  });
});
