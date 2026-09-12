import { describe, expect, it } from 'vitest';
import { entryAt, sceneAt } from '../components/floors/floor-replay';
import {
  DAY_MS,
  dateOf,
  dayAt,
  dayInputAt,
  dayMoments,
  dayOf,
  momentAt,
  yesterday,
  type DayRecord,
} from '../components/office/day-replay';
import type { AuditTimeline } from '../lib/contracts';

const START = 1_700_000_000_000;
const at = (seconds: number) => START + seconds * 1000;

const timeline: AuditTimeline = {
  task: {
    id: 'tsk_1',
    title: 'Draft the release note',
    employeeName: 'Ada',
    status: 'completed',
    createdAt: START,
    createdByName: 'Sam',
  },
  entries: [
    {
      kind: 'event',
      id: 'e1',
      at: at(0),
      type: 'agent.session.turn.created',
      text: 'Employee started a turn.',
    },
    {
      kind: 'tool_call',
      id: 't1',
      at: at(10),
      operationId: 'op1',
      connectionId: 'con_1',
      provider: 'linear',
      tool: 'linear_list_issues',
      outcome: 'started',
    },
    {
      kind: 'tool_call',
      id: 't2',
      at: at(14),
      operationId: 'op1',
      connectionId: 'con_1',
      provider: 'linear',
      tool: 'linear_list_issues',
      outcome: 'succeeded',
    },
    {
      kind: 'proposal',
      id: 'p1',
      at: at(20),
      tool: 'linear_create_issue',
      provider: 'linear',
      summary: 'Create the release issue',
      status: 'approved',
      correction: 'supported',
      arguments: {},
      transitions: [{ to: 'approved', actor: 'user_1', at: at(40) }],
    },
    {
      kind: 'message',
      id: 'm1',
      at: at(50),
      role: 'assistant',
      text: 'The release note is ready. See the draft.',
    },
  ],
};

const activityAt = (seconds: number) => sceneAt(timeline, 'emp_ada', at(seconds)).activities.get('emp_ada');

describe('replaying a task', () => {
  it('reenacts the recorded turn, tool call and review in order', () => {
    expect(activityAt(1)?.activity).toBe('thinking');
    expect(activityAt(11)).toMatchObject({ activity: 'calling', tool: 'linear_list_issues' });
    expect(activityAt(16)?.activity).toBe('reading');
    // The proposal is still pending at 30s, so the figure is waiting for a decision.
    expect(activityAt(30)?.activity).toBe('reviewing');
    // Once it is approved and the last message lands, the task reads as done.
    expect(activityAt(50)).toMatchObject({ activity: 'celebrating' });
  });

  it('collects the providers the task actually called', () => {
    expect(sceneAt(timeline, 'emp_ada', at(5)).providers).toEqual([]);
    expect(sceneAt(timeline, 'emp_ada', at(12)).providers).toMatchObject([{ id: 'linear', name: 'Linear' }]);
  });

  it('shows the last message as the bubble while it is fresh', () => {
    expect(activityAt(50)?.bubble).toBe('The release note is ready.');
  });

  it('names the entry the scrubber is sitting on', () => {
    expect(entryAt(timeline, at(0))).toBe('Employee started a turn.');
    expect(entryAt(timeline, at(12))).toBe('linear_list_issues: started');
    expect(entryAt(timeline, at(21))).toBe('Proposed linear_create_issue: Create the release issue');
    expect(entryAt(timeline, at(-5))).toBe('');
  });
});

/**
 * Replaying a whole day. The record is the one the lab photographs: three people
 * on shift, a meeting at eleven, an alert in the afternoon that triage takes
 * without waiting for an answer, and last night's finding still on Bruno's desk.
 */
const DAY = new Date(2026, 8, 9).getTime();
const hour = (value: number) => DAY + value * 3_600_000;
const ada = { id: 'emp_ada', name: 'Ada' };
const bruno = { id: 'emp_bruno', name: 'Bruno' };
const emi = { id: 'emp_emi', name: 'Emi' };

const record: DayRecord = {
  from: DAY,
  to: DAY + DAY_MS,
  employees: [ada, bruno, emi],
  schedule: {
    timezone: 'Europe/London',
    workingDays: [1, 2, 3, 4, 5],
    startHour: 9,
    endHour: 18,
    attendedStartHour: 9,
    attendedEndHour: 18,
    overnightPolicy: 'cheap',
    working: true,
    attended: true,
    usageToday: { input: 0, output: 0, cached: 0, cap: 0 },
  },
  tasks: [
    {
      id: 'tsk_triage',
      floorId: 'flr_1',
      employeeId: emi.id,
      employeeName: emi.name,
      kind: 'triage',
      createdBy: 'system',
      createdByName: 'Astra HQ',
      isOwner: true,
      visibility: 'workspace',
      title: 'Checkout incident',
      prompt: '',
      status: 'completed',
      createdAt: hour(14.4),
      updatedAt: hour(16),
      model: 'gpt-5.6-terra',
    },
  ],
  shifts: [
    { employeeId: ada.id, startedAt: hour(9), endedAt: hour(17.5) },
    { employeeId: bruno.id, startedAt: hour(9.1), endedAt: hour(17.8) },
  ],
  meetings: [
    {
      entry: {
        id: 'cal_review',
        kind: 'meeting',
        title: 'September release review',
        startsAt: hour(11),
        endsAt: hour(11.75),
        attendees: [
          { kind: 'employee', id: ada.id, name: ada.name },
          { kind: 'employee', id: bruno.id, name: bruno.name },
        ],
        agenda: [],
        status: 'scheduled',
      },
      meeting: {
        id: 'mtg_review',
        calendarEntryId: 'cal_review',
        status: 'closed',
        openedAt: hour(11.03),
        closedAt: hour(11.7),
        turns: [
          {
            id: 'trn_2',
            kind: 'answer',
            authorName: 'Bruno',
            employeeId: bruno.id,
            text: 'Signed off this morning. The pricing page is the one at risk.',
            createdAt: hour(11.2),
          },
        ],
      },
    },
  ],
  findings: [
    {
      id: 'fnd_1',
      employeeId: bruno.id,
      employeeName: 'Bruno',
      auditDate: '2026-09-08',
      severity: 'medium',
      claim: 'The report claims the tests pass; the journal has no test run.',
      evidence: 'No tool call before the report.',
      requiredAction: 'Run the tests and post the output.',
      status: 'addressed',
      createdAt: hour(-1.2),
      updatedAt: hour(9.8),
    },
  ],
  alerts: [
    {
      id: 'alr_1',
      source: 'github',
      fingerprint: 'checkout-500',
      severity: 'high',
      title: 'Checkout is returning 500 on card payments.',
      detail: '',
      status: 'closed',
      triageTaskId: 'tsk_triage',
      affectedFloorIds: [],
      occurrences: 5,
      paging: { attempts: 0, required: 3, acknowledged: true },
      createdAt: hour(14.3),
      updatedAt: hour(16.1),
    },
  ],
  notifications: [
    {
      id: 'ntf_1',
      kind: 'triage',
      title: 'Deployed the checkout fix without approval.',
      text: '',
      alertId: 'alr_1',
      attempt: 3,
      sentAt: hour(15),
    },
  ],
};

const atHour = (value: number) => dayAt(record, undefined, hour(value));
const activity = (value: number, id: string) => atHour(value).activities.get(id)?.activity;

describe('replaying a day', () => {
  it('opens the floor empty, fills it at nine, and empties it again at six', () => {
    expect(activity(8, ada.id)).toBe('off_shift');
    expect(activity(9.02, ada.id)).toBe('arriving');
    expect(activity(13, ada.id)).toBe('thinking');
    expect(activity(17.55, ada.id)).toBe('leaving');
    expect(activity(19, ada.id)).toBe('off_shift');
  });

  it('holds the meeting: gathering, then live with the floor to whoever answered', () => {
    expect(activity(10.5, bruno.id)).toBe('preparing');
    expect(activity(11.21, bruno.id)).toBe('presenting');
    expect(atHour(11.21).signals.meeting).toMatchObject({ live: true, speakingId: bruno.id });
    // Once it is closed the meeting is over, whatever the record's final status says.
    expect(atHour(11.71).signals.meeting).toBeUndefined();
  });

  it('leaves last night\'s finding open until the morning it was addressed', () => {
    expect(activity(9.5, bruno.id)).toBe('uneasy');
    expect(atHour(9.5).signals.findings.get(bruno.id)).toBe(1);
    expect(atHour(12).signals.findings.get(bruno.id)).toBeUndefined();
  });

  it('raises the incident, puts triage on it, and carries the notice after three attempts', () => {
    expect(atHour(14).signals.incident).toBe(false);
    expect(atHour(14.5).signals.incident).toBe(true);
    expect(activity(14.5, emi.id)).toBe('triaging');
    expect(atHour(14.5).signals.emergency).toBeUndefined();
    expect(atHour(15.5).signals.emergency).toMatchObject({
      title: 'Deployed the checkout fix without approval.',
    });
    // The alert closed at 16:06, so the beacon goes out.
    expect(atHour(17).signals.incident).toBe(false);
  });

  it('shows nothing that has not happened yet', () => {
    const early = dayInputAt(record, hour(8));
    expect(early.alerts).toEqual([]);
    expect(early.meetings).toEqual([]);
    expect(early.shifts).toEqual([]);
    expect(early.notifications).toEqual([]);
  });

  it('names the day in order, and what the scrubber is sitting on', () => {
    const moments = dayMoments(record).map((moment) => moment.text);
    expect(moments[0]).toBe('Ada started a shift');
    expect(moments).toContain('September release review opened');
    expect(moments).toContain('Alert: Checkout is returning 500 on card payments.');
    expect(moments).toContain('Emergency: Deployed the checkout fix without approval.');
    expect(dayMoments(record).map((moment) => moment.at)).toEqual(
      [...dayMoments(record).map((moment) => moment.at)].sort((a, b) => a - b),
    );
    expect(momentAt(record, hour(15.2))).toBe('Emergency: Deployed the checkout fix without approval.');
    expect(momentAt(record, hour(1))).toBe('');
  });

  it('reads a yyyy-mm-dd day and writes one back', () => {
    expect(dayOf('2026-09-09')).toEqual({ from: DAY, to: DAY + DAY_MS });
    expect(dateOf(DAY)).toBe('2026-09-09');
    expect(dayOf('not a day')).toBeUndefined();
    expect(yesterday(DAY + 11 * 3_600_000)).toEqual({ from: DAY - DAY_MS, to: DAY });
  });
});
