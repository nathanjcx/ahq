import { describe, expect, it } from 'vitest';
import {
  planTick,
  type PlannedJob,
  type PlannerInput,
  type PlannerInstance,
  type PlannerTask,
} from '../convex/lib/schedule';
import { defaultWorkspaceSettings, type WorkspaceSettings } from '../lib/contracts';

const settings: WorkspaceSettings = {
  ...defaultWorkspaceSettings,
  timezone: 'America/New_York',
  updatedAt: 0,
};
/** Monday 2026-06-01, 10:00 in New York: inside the default nine to six working day. */
const monday = Date.parse('2026-06-01T14:00:00Z');
/** The same Monday at 22:00 in New York, four hours after the working day closed. */
const mondayNight = Date.parse('2026-06-02T02:00:00Z');

function worker(employeeId: string, extra: Partial<PlannerInstance> = {}): PlannerInstance {
  return { employeeId, kind: 'worker', model: 'gpt-5.6-terra', ...extra };
}
function daily(taskId: string, employeeId: string, extra: Partial<PlannerTask> = {}): PlannerTask {
  return {
    taskId,
    employeeId,
    status: 'running',
    cadence: 'daily',
    unfinishedDependencies: [],
    model: 'gpt-5.6-terra',
    ...extra,
  };
}
function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    now: monday,
    settings,
    tasks: [],
    instances: [],
    meetings: [],
    alerts: [],
    findings: [],
    proposedMemories: 0,
    usageToday: 0,
    triageUsageToday: 0,
    freeSlots: 4,
    busyEmployeeIds: [],
    ...overrides,
  };
}
const shape = (jobs: PlannedJob[]) => jobs.map((job) => [job.kind, job.taskId]);

describe('work shifts', () => {
  it('gives every daily task one shift a day and none once it has run', () => {
    const plan = input({
      tasks: [daily('one', 'ann'), daily('two', 'bob')],
      instances: [worker('ann'), worker('bob')],
    });
    expect(shape(planTick(plan))).toEqual([
      ['shift', 'one'],
      ['shift', 'two'],
    ]);
    expect(planTick(plan)[0].uniqueKey).toBe('shift:one:2026-06-01');
    const afterRun = { ...plan, tasks: plan.tasks.map((task) => ({ ...task, lastShiftDate: '2026-06-01' })) };
    expect(planTick(afterRun)).toEqual([]);
  });

  it('leads the day with the instance that has open findings, then the earliest deadline', () => {
    const plan = input({
      tasks: [
        daily('late', 'ann', { deadlineAt: monday + 10 * 86_400_000 }),
        daily('soon', 'bob', { deadlineAt: monday + 86_400_000 }),
        daily('flagged', 'cat', { deadlineAt: monday + 30 * 86_400_000 }),
      ],
      instances: [worker('ann'), worker('bob'), worker('cat')],
      findings: [{ findingId: 'f1', employeeId: 'cat' }],
    });
    expect(shape(planTick(plan))).toEqual([
      ['shift', 'flagged'],
      ['shift', 'soon'],
      ['shift', 'late'],
    ]);
    expect(planTick(plan)[0].findingIds).toEqual(['f1']);
  });

  it('never schedules a task whose dependency is unfinished, and reviews it once a day instead', () => {
    const plan = input({
      tasks: [daily('blocked', 'ann', { status: 'waiting', unfinishedDependencies: ['other'] })],
      instances: [worker('ann')],
    });
    expect(shape(planTick(plan))).toEqual([['review_shift', 'blocked']]);
    expect(planTick(plan)[0].uniqueKey).toBe('review:blocked:2026-06-01');
    const reviewed = {
      ...plan,
      tasks: plan.tasks.map((task) => ({ ...task, lastReviewDate: '2026-06-01' })),
    };
    expect(planTick(reviewed)).toEqual([]);
    // A review shift is a working-day habit, so the night brings nothing.
    expect(planTick({ ...plan, now: mondayNight })).toEqual([]);
  });

  it('stops at the free slots and never gives one instance two runs at once', () => {
    const plan = input({
      tasks: [daily('one', 'ann'), daily('two', 'bob'), daily('three', 'cat')],
      instances: [worker('ann'), worker('bob'), worker('cat')],
      freeSlots: 2,
    });
    expect(planTick(plan)).toHaveLength(2);
    expect(planTick({ ...plan, freeSlots: 0 })).toEqual([]);
    expect(shape(planTick({ ...plan, busyEmployeeIds: ['ann', 'bob'] }))).toEqual([['shift', 'three']]);
  });
});

describe('hours and the zone', () => {
  it('works only inside the working hours of the workspace itself', () => {
    const plan = input({ tasks: [daily('one', 'ann')], instances: [worker('ann')] });
    expect(planTick({ ...plan, now: mondayNight })).toEqual([]);
    // 09:00 in Berlin is 03:00 in New York: the same instant, only one workspace at work.
    const berlin = { ...settings, timezone: 'Europe/Berlin' };
    const morning = Date.parse('2026-06-01T07:00:00Z');
    expect(planTick({ ...plan, now: morning })).toEqual([]);
    expect(shape(planTick({ ...plan, now: morning, settings: berlin }))).toEqual([['shift', 'one']]);
  });

  it('runs the night on the overnight model when the policy is cheap, still once for the day', () => {
    const cheap = { ...settings, overnightPolicy: 'cheap' as const };
    const plan = input({
      now: mondayNight,
      settings: cheap,
      tasks: [daily('one', 'ann'), daily('two', 'bob')],
      instances: [worker('ann', { overnightModel: 'gpt-5.6-luna' }), worker('bob')],
    });
    const jobs = planTick(plan);
    expect(jobs.map((job) => [job.taskId, job.model, job.date])).toEqual([
      ['one', 'gpt-5.6-luna', '2026-06-01'],
      ['two', 'gpt-5.6-terra', '2026-06-01'],
    ]);
    // The night belongs to the working day that opened it, so a shift already run today blocks it.
    expect(
      planTick({ ...plan, tasks: plan.tasks.map((task) => ({ ...task, lastShiftDate: '2026-06-01' })) }),
    ).toEqual([]);
    // Early the next morning the night is still Monday's.
    expect(planTick({ ...plan, now: Date.parse('2026-06-02T05:00:00Z') })[0].date).toBe('2026-06-01');
  });
});

describe('the reserved teams', () => {
  it('audits after hours in the night’s own task, once per date', () => {
    const plan = input({
      now: mondayNight,
      instances: [worker('aud', { kind: 'auditor', auditTaskId: 'audit-task' })],
    });
    expect(planTick(plan).map((job) => [job.kind, job.taskId, job.uniqueKey])).toEqual([
      ['audit', 'audit-task', 'audit:aud:2026-06-01'],
    ]);
    expect(planTick({ ...plan, now: monday })).toEqual([]);
  });

  it('curates after hours and again for every twenty waiting claims', () => {
    const janitor = worker('jan', { kind: 'janitor', standingTaskId: 'janitor-task' });
    expect(planTick(input({ instances: [janitor] }))).toEqual([]);
    expect(planTick(input({ now: mondayNight, instances: [janitor] }))[0].uniqueKey).toBe(
      'curation:jan:2026-06-01',
    );
    expect(planTick(input({ instances: [janitor], proposedMemories: 25 }))[0].uniqueKey).toBe(
      'curation:jan:2026-06-01:1',
    );
    expect(planTick(input({ instances: [janitor], proposedMemories: 45 }))[0].uniqueKey).toBe(
      'curation:jan:2026-06-01:2',
    );
  });

  it('leaves an auditor without tonight’s task, or a janitor without a session, alone', () => {
    expect(
      planTick(
        input({
          now: mondayNight,
          instances: [
            worker('aud', { kind: 'auditor', standingTaskId: 'standing' }),
            worker('jan', { kind: 'janitor' }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('triage and preparation', () => {
  const responder = worker('tri', { kind: 'triage', standingTaskId: 'triage-task' });

  it('preempts the working day, the free slots, and the hours', () => {
    const plan = input({
      freeSlots: 0,
      instances: [responder, worker('ann')],
      tasks: [daily('one', 'ann')],
      alerts: [
        { alertId: 'low', severity: 'low', createdAt: 1 },
        { alertId: 'bad', severity: 'critical', createdAt: 2 },
      ],
    });
    // One responder takes the worst alert first, and the shift still waits for a slot.
    expect(planTick(plan).map((job) => [job.kind, job.alertId, job.uniqueKey])).toEqual([
      ['triage', 'bad', 'triage:bad'],
    ]);
    expect(planTick({ ...plan, now: mondayNight })).toHaveLength(1);
    expect(
      planTick({ ...plan, instances: [responder, worker('two', { kind: 'triage', standingTaskId: 't2' })] }),
    ).toHaveLength(2);
  });

  it('runs an alert in the task triage already opened for it', () => {
    const jobs = planTick(
      input({
        instances: [responder],
        alerts: [{ alertId: 'bad', severity: 'high', createdAt: 1, triageTaskId: 'alert-task' }],
      }),
    );
    expect(jobs[0].taskId).toBe('alert-task');
  });

  it('prepares each attendee once, sixty working minutes out', () => {
    const meetings = [
      {
        entryId: 'e1',
        meetingId: 'm1',
        startsAt: monday + 90 * 60_000,
        attendees: [{ employeeId: 'ann', taskId: 'hidden' }],
      },
    ];
    const plan = input({ instances: [worker('ann')], meetings });
    expect(planTick(plan)).toEqual([]);
    const soon = { ...plan, meetings: [{ ...meetings[0], startsAt: monday + 45 * 60_000 }] };
    // The turn runs on the meeting's own hidden task, under the one `meeting_prep` job kind.
    expect(planTick(soon).map((job) => [job.kind, job.taskId, job.uniqueKey])).toEqual([
      ['meeting_prep', 'hidden', 'meeting_prep:m1:ann'],
    ]);
    // Preparation comes before the day's own work when the instance can only do one.
    const busyDay = { ...soon, tasks: [daily('one', 'ann')] };
    expect(shape(planTick(busyDay))).toEqual([['meeting_prep', 'hidden']]);
    // A meeting already under way is not prepared for.
    expect(planTick({ ...plan, meetings: [{ ...meetings[0], startsAt: monday - 60_000 }] })).toEqual([]);
  });
});

describe('caps', () => {
  it('stops ordinary work at the daily token cap but still answers alerts', () => {
    const capped = { ...settings, dailyTokenCap: 1_000 };
    const plan = input({
      settings: capped,
      usageToday: 1_000,
      tasks: [daily('one', 'ann')],
      instances: [worker('ann'), worker('tri', { kind: 'triage', standingTaskId: 'triage-task' })],
      alerts: [{ alertId: 'bad', severity: 'high', createdAt: 1 }],
    });
    expect(shape(planTick(plan))).toEqual([['triage', 'triage-task']]);
    expect(shape(planTick({ ...plan, usageToday: 999 }))).toEqual([
      ['triage', 'triage-task'],
      ['shift', 'one'],
    ]);
  });

  it('stops triage at its own allowance', () => {
    const plan = input({
      settings: { ...settings, triageAllowance: 500 },
      triageUsageToday: 500,
      instances: [worker('tri', { kind: 'triage', standingTaskId: 'triage-task' })],
      alerts: [{ alertId: 'bad', severity: 'high', createdAt: 1 }],
    });
    expect(planTick(plan)).toEqual([]);
    expect(planTick({ ...plan, triageUsageToday: 499 })).toHaveLength(1);
  });
});
