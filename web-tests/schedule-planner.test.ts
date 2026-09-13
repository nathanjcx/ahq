import { describe, expect, it } from 'vitest';
import {
  planTick,
  type PlannedJob,
  type PlannerAlert,
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
    model: 'gpt-5.6-terra',
    ...extra,
  };
}
/** An open alert nobody has been paged about yet. */
function alert(alertId: string, extra: Partial<PlannerAlert> = {}): PlannerAlert {
  return {
    alertId,
    severity: 'high',
    createdAt: 1,
    paging: { attempts: 0, required: 3, acknowledged: false, nextAttemptAt: monday },
    pagesSent: 0,
    runLive: false,
    runKeys: [],
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

  it('reviews a waiting task once a day and shifts it again once a person has released it', () => {
    const plan = input({
      tasks: [daily('held', 'ann', { status: 'waiting' })],
      instances: [worker('ann')],
    });
    expect(shape(planTick(plan))).toEqual([['review_shift', 'held']]);
    expect(planTick(plan)[0].uniqueKey).toBe('review:held:2026-06-01');
    const reviewed = {
      ...plan,
      tasks: plan.tasks.map((task) => ({ ...task, lastReviewDate: '2026-06-01' })),
    };
    expect(planTick(reviewed)).toEqual([]);
    // A review shift is a working-day habit, so the night brings nothing.
    expect(planTick({ ...plan, now: mondayNight })).toEqual([]);
    // A dependency that failed leaves the dependent `blocked`, which is a person's to decide: it is
    // neither shifted nor reviewed every day for as long as the project lasts.
    const blocked = { ...plan, tasks: [daily('held', 'ann', { status: 'blocked' })] };
    expect(planTick(blocked)).toEqual([]);
    // And once a person unblocks it, it shifts like any other daily task, whatever its dependency did.
    const released = { ...plan, tasks: [daily('held', 'ann', { status: 'queued' })] };
    expect(shape(planTick(released))).toEqual([['shift', 'held']]);
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
        alert('low', { severity: 'low' }),
        alert('bad', { severity: 'critical', createdAt: 2 }),
      ],
    });
    // One responder takes the worst alert first, and the shift still waits for a slot. The run's key
    // carries the ledger it is briefed with, so a page that lands plans a run that knows about it.
    expect(planTick(plan).map((job) => [job.kind, job.alertId, job.uniqueKey])).toEqual([
      ['triage', 'bad', 'triage:bad:0'],
    ]);
    // At night nobody is watching, so the incident worth waking someone for is also paged. The low
    // one is not: it waits for the morning.
    expect(
      planTick({ ...plan, now: mondayNight })
        .map((job) => [job.kind, job.alertId])
        .sort(),
    ).toEqual([
      ['page', 'bad'],
      ['triage', 'bad'],
    ]);
    expect(
      planTick({ ...plan, instances: [responder, worker('two', { kind: 'triage', standingTaskId: 't2' })] }),
    ).toHaveLength(2);
  });

  it('runs an alert in the task triage already opened for it', () => {
    const jobs = planTick(
      input({
        instances: [responder],
        alerts: [alert('bad', { triageTaskId: 'alert-task' })],
      }),
    );
    expect(jobs[0].taskId).toBe('alert-task');
  });

  it('plans one run per state of an incident, and never starves another alert waiting on a person', () => {
    const ledger = (attempts: number) => ({
      attempts,
      required: 3,
      acknowledged: false,
      firstAttemptAt: mondayNight - 30 * 60_000,
      nextAttemptAt: undefined,
    });
    const plan = (extra: Partial<PlannerAlert>) =>
      planTick(
        input({
          now: mondayNight,
          settings: { ...settings, overnightPolicy: 'audits_only' },
          instances: [responder],
          alerts: [
            alert('first', { severity: 'critical', triageTaskId: 'first-task', ...extra }),
            alert('second', { severity: 'high', createdAt: 2, triageTaskId: 'second-task' }),
          ],
        }),
      ).filter((job) => job.kind === 'triage');
    // A run already queued or in flight is not planned twice, and the responder it would have taken
    // goes to the other incident instead.
    expect(plan({ runLive: true }).map((job) => job.alertId)).toEqual(['second']);
    // Nor is a run planned again for a state of the incident that has already had one: the finished
    // run's key still stands, so the other alert is what this tick answers.
    expect(plan({ runKeys: ['triage:first:0'] }).map((job) => job.alertId)).toEqual(['second']);
    // Once the ledger moves the key moves with it, and the incident gets a run briefed on the pages.
    expect(plan({ runKeys: ['triage:first:0'], paging: ledger(1) }).map((job) => job.uniqueKey)).toEqual([
      'triage:first:1',
    ]);
    // And when the emergency rule opens, the run that may act on it is a run of its own.
    expect(
      plan({ runKeys: ['triage:first:0', 'triage:first:3'], paging: { ...ledger(3), opensAt: mondayNight } })
        .map((job) => job.uniqueKey),
    ).toEqual(['triage:first:3:e']);
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
      alerts: [alert('bad')],
    });
    expect(shape(planTick(plan))).toEqual([['triage', 'triage-task']]);
    expect(shape(planTick({ ...plan, usageToday: 999 }))).toEqual([
      ['triage', 'triage-task'],
      ['shift', 'one'],
    ]);
    // A page costs no tokens, so the cap never keeps an incident from reaching a person.
  });

  it('stops triage at its own allowance', () => {
    const plan = input({
      settings: { ...settings, triageAllowance: 500 },
      triageUsageToday: 500,
      instances: [worker('tri', { kind: 'triage', standingTaskId: 'triage-task' })],
      alerts: [alert('bad')],
    });
    expect(planTick(plan)).toEqual([]);
    expect(planTick({ ...plan, triageUsageToday: 499 })).toHaveLength(1);
  });
});

describe('the emergency rule', () => {
  const responder = worker('tri', { kind: 'triage', standingTaskId: 'triage-task' });
  const night = { ...settings, overnightPolicy: 'audits_only' as const };

  it('pages an unanswered incident on the re-page interval until three pages have been sent', () => {
    const at = (attempts: number, lastAttemptAt?: number) =>
      planTick(
        input({
          now: mondayNight,
          settings: night,
          instances: [responder],
          alerts: [
            alert('bad', {
              triageTaskId: 'alert-task',
              pagesSent: attempts,
              paging: {
                attempts,
                required: 3,
                acknowledged: false,
                lastAttemptAt,
                // `pagingState` stops naming a next page once three have been sent, answered or not.
                nextAttemptAt:
                  attempts >= 3
                    ? undefined
                    : lastAttemptAt === undefined
                      ? mondayNight
                      : lastAttemptAt + 7 * 60_000,
              },
            }),
          ],
        }),
      ).filter((job) => job.kind === 'page');
    // The first page goes out at once, on the responder's standing session rather than on the
    // incident's own task, which is busy with the turn.
    expect(at(0).map((job) => [job.taskId, job.uniqueKey])).toEqual([['triage-task', 'page:bad:1']]);
    // The second waits for the interval, then goes out with the next attempt number.
    expect(at(1, mondayNight - 60_000)).toEqual([]);
    expect(at(1, mondayNight - 8 * 60_000).map((job) => job.uniqueKey)).toEqual(['page:bad:2']);
    expect(at(2, mondayNight - 8 * 60_000).map((job) => job.uniqueKey)).toEqual(['page:bad:3']);
    // Three pages is the whole ledger; nothing pages again.
    expect(at(3, mondayNight - 8 * 60_000)).toEqual([]);
  });

  it('pages nobody inside attended hours or after an acknowledgement', () => {
    const paging = { attempts: 1, required: 3, acknowledged: false, lastAttemptAt: monday - 3_600_000 };
    const attended = input({ instances: [responder], alerts: [alert('bad', { paging })] });
    expect(planTick(attended).map((job) => job.kind)).toEqual(['triage']);
    const answered = input({
      now: mondayNight,
      settings: night,
      instances: [responder],
      alerts: [alert('bad', { paging: { ...paging, acknowledged: true } })],
    });
    expect(planTick(answered).map((job) => job.kind)).toEqual(['triage']);
  });
});

describe('the overnight policy', () => {
  const nightly = (overnightPolicy: WorkspaceSettings['overnightPolicy']) =>
    planTick(
      input({
        now: mondayNight,
        settings: { ...settings, overnightPolicy },
        tasks: [daily('one', 'ann')],
        instances: [
          worker('ann', { overnightModel: 'gpt-5.6-luna' }),
          worker('aud', { kind: 'auditor', standingTaskId: 'standing', auditTaskId: 'audit-task' }),
          worker('jan', { kind: 'janitor', standingTaskId: 'janitor-task' }),
        ],
      }),
    );

  it('runs nothing outside working hours when it is off, not even the audit', () => {
    expect(nightly('off')).toEqual([]);
  });

  it('runs the reserved nights only when it is audits_only', () => {
    expect(shape(nightly('audits_only')).sort()).toEqual([
      ['audit', 'audit-task'],
      ['curation', 'janitor-task'],
    ]);
  });

  it('adds the day’s shifts on the overnight model when it is cheap', () => {
    const cheap = nightly('cheap');
    expect(shape(cheap).sort()).toEqual([
      ['audit', 'audit-task'],
      ['curation', 'janitor-task'],
      ['shift', 'one'],
    ]);
    expect(cheap.find((job) => job.kind === 'shift')?.model).toBe('gpt-5.6-luna');
  });
});

describe('the audit policy', () => {
  const plan = (auditPolicy: WorkspaceSettings['auditPolicy']) =>
    input({
      settings: { ...settings, auditPolicy },
      tasks: [
        daily('flagged', 'ann', { deadlineAt: monday + 86_400_000 }),
        daily('other', 'ann', { deadlineAt: monday + 2 * 86_400_000 }),
        daily('waiting', 'ann', { status: 'waiting' }),
        daily('clear', 'bob'),
      ],
      instances: [worker('ann'), worker('bob')],
      findings: [{ findingId: 'f1', employeeId: 'ann' }],
    });

  it('lets other work follow the findings the same day when it is soft', () => {
    // One run per instance per tick, so the flagged instance takes its leading shift; the tick after
    // the shift ends offers the rest of its day.
    const soft = plan('soft');
    expect(shape(planTick(soft))).toEqual([
      ['shift', 'flagged'],
      ['shift', 'clear'],
    ]);
    const later = { ...soft, tasks: soft.tasks.map((task) => task.taskId === 'flagged' ? { ...task, lastShiftDate: '2026-06-01' } : task) };
    expect(shape(planTick(later))).toEqual([
      ['shift', 'other'],
      ['shift', 'clear'],
    ]);
  });

  it('runs nothing else for a flagged instance when it is hard', () => {
    const hard = plan('hard');
    expect(shape(planTick(hard))).toEqual([
      ['shift', 'flagged'],
      ['shift', 'clear'],
    ]);
    // Its other tasks and its review shift stay held until the findings are addressed.
    const later = { ...hard, tasks: hard.tasks.map((task) => task.taskId === 'flagged' ? { ...task, lastShiftDate: '2026-06-01' } : task) };
    expect(shape(planTick(later))).toEqual([['shift', 'clear']]);
    // Cleared findings release the day; the instance takes its next task, one run at a time.
    expect(shape(planTick({ ...later, findings: [] }))).toEqual([
      ['shift', 'other'],
      ['shift', 'clear'],
    ]);
  });
});
