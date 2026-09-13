import { describe, expect, it } from 'vitest';
import {
  BUBBLE_MS,
  CELEBRATING_MS,
  FAILED_MS,
  READING_MS,
  STUCK_MS,
  deriveActivities,
  deriveFloorSignals,
  firstSentence,
  isWorking,
  providerForTool,
  shiftsFromCalendar,
  type ActivityInput,
} from '../components/office/activity';
import type {
  ActionProposal,
  ActivityEvent,
  Alert,
  AuditFinding,
  CalendarEntry,
  FloorPost,
  Meeting,
  ScheduleSummary,
  Task,
} from '../lib/contracts';

const NOW = 1_700_000_000_000;
const ada = { id: 'emp_ada', name: 'Ada' };
const bo = { id: 'emp_bo', name: 'Bo' };

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  return {
    floorId: 'prj_1',
    employeeId: ada.id,
    employeeName: ada.name,
    createdBy: 'user_1',
    createdByName: 'Sam',
    isOwner: true,
    visibility: 'workspace',
    title: 'Draft the release note',
    prompt: 'Draft it',
    createdAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    model: 'gpt-5.6-terra',
    ...overrides,
  };
}

let sequence = 0;
function event(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, 'type' | 'text'>): ActivityEvent {
  sequence += 1;
  return {
    id: `evt_${sequence}`,
    sequence,
    taskId: 'tsk_1',
    createdAt: NOW - 1_000,
    ...overrides,
  };
}

function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: 'act_1',
    taskId: 'tsk_1',
    connectionId: 'con_1',
    employeeName: ada.name,
    provider: 'linear',
    tool: 'linear_create_issue',
    arguments: '{}',
    summary: 'Create an issue',
    status: 'pending',
    correction: 'supported',
    correctionReason: '',
    createdAt: NOW - 5_000,
    canDecide: true,
    ...overrides,
  };
}

function handoffPost(overrides: Partial<FloorPost> = {}): FloorPost {
  return {
    id: 'pst_1',
    floorId: 'prj_1',
    kind: 'handoff',
    authorName: bo.name,
    text: 'Handoff requested',
    createdAt: NOW - 30_000,
    handoff: {
      toEmployeeId: ada.id,
      toEmployeeName: ada.name,
      brief: 'Take the release note from here. It needs the changelog links.',
      status: 'pending',
    },
    ...overrides,
  };
}

function derive(input: Partial<ActivityInput> = {}) {
  return deriveActivities({
    employees: [ada, bo],
    tasks: [],
    events: [],
    proposals: [],
    posts: [],
    now: NOW,
    ...input,
  });
}

describe('deriveActivities', () => {
  it('leaves an employee with no work idle', () => {
    expect(derive().get(ada.id)).toEqual({ activity: 'idle', since: 0 });
  });

  it('reads a started turn as thinking', () => {
    const state = derive({
      tasks: [task({ id: 'tsk_1', status: 'running' })],
      events: [event({ type: 'agent.session.turn.created', text: 'Employee started a turn.' })],
    }).get(ada.id);
    expect(state?.activity).toBe('thinking');
  });

  it('treats a queued task as thinking', () => {
    expect(derive({ tasks: [task({ id: 'tsk_1', status: 'queued' })] }).get(ada.id)?.activity).toBe(
      'thinking',
    );
  });

  it('walks to a provider while a tool call is started', () => {
    const state = derive({
      tasks: [task({ id: 'tsk_1', status: 'running' })],
      events: [event({ type: 'tool_call', text: 'linear_list_issues: started' })],
    }).get(ada.id);
    expect(state).toMatchObject({ activity: 'calling', tool: 'linear_list_issues', provider: 'linear' });
  });

  it('reads for twenty seconds after a tool call succeeds, then thinks', () => {
    const succeeded = event({
      type: 'tool_call',
      text: 'github_get_file: succeeded',
      createdAt: NOW - (READING_MS - 1_000),
    });
    expect(
      derive({ tasks: [task({ id: 'tsk_1', status: 'running' })], events: [succeeded] }).get(ada.id)
        ?.activity,
    ).toBe('reading');
    expect(
      derive({
        tasks: [task({ id: 'tsk_1', status: 'running' })],
        events: [{ ...succeeded, createdAt: NOW - (READING_MS + 1_000) }],
      }).get(ada.id)?.activity,
    ).toBe('thinking');
  });

  it('types while assistant output is arriving', () => {
    const state = derive({
      tasks: [
        task({
          id: 'tsk_1',
          status: 'running',
          lastMessage: { text: 'Checking the changelog now. Then I will draft.', createdAt: NOW - 2_000 },
        }),
      ],
      events: [event({ type: 'tool_call', text: 'linear_list_issues: started' })],
    }).get(ada.id);
    expect(state?.activity).toBe('writing');
    expect(state?.bubble).toBe('Checking the changelog now.');
  });

  it('reviews when the task is awaiting approval or the session requires action', () => {
    expect(
      derive({ tasks: [task({ id: 'tsk_1', status: 'awaiting_approval' })] }).get(ada.id)?.activity,
    ).toBe('reviewing');
    expect(
      derive({
        tasks: [task({ id: 'tsk_1', status: 'running' })],
        events: [event({ type: 'agent.session.requires_action', text: 'The session needs external input.' })],
      }).get(ada.id)?.activity,
    ).toBe('reviewing');
  });

  it('celebrates a completion for ninety seconds', () => {
    const done = (age: number) => task({ id: 'tsk_1', status: 'completed', updatedAt: NOW - age });
    expect(derive({ tasks: [done(CELEBRATING_MS - 1_000)] }).get(ada.id)?.activity).toBe('celebrating');
    expect(derive({ tasks: [done(CELEBRATING_MS + 1_000)] }).get(ada.id)?.activity).toBe('idle');
  });

  it('sits down after a failure for five minutes', () => {
    const broken = (status: Task['status'], age: number) =>
      task({ id: 'tsk_1', status, updatedAt: NOW - age });
    expect(derive({ tasks: [broken('failed', FAILED_MS - 1_000)] }).get(ada.id)?.activity).toBe('failed');
    expect(derive({ tasks: [broken('uncertain', FAILED_MS - 1_000)] }).get(ada.id)?.activity).toBe('failed');
    expect(derive({ tasks: [broken('failed', FAILED_MS + 1_000)] }).get(ada.id)?.activity).toBe('idle');
  });

  it('turns both employees toward each other for a pending handoff', () => {
    const states = derive({ posts: [handoffPost()] });
    expect(states.get(ada.id)).toMatchObject({ activity: 'talking', partnerId: bo.id });
    expect(states.get(bo.id)).toMatchObject({ activity: 'talking', partnerId: ada.id });
    expect(states.get(ada.id)?.bubble).toBe('Take the release note from here.');
  });

  it('ignores a handoff that has already been decided', () => {
    const decided = handoffPost({
      handoff: { ...handoffPost().handoff!, status: 'accepted' },
    });
    expect(derive({ posts: [decided] }).get(ada.id)?.activity).toBe('idle');
  });

  it('keeps live work ahead of an open handoff', () => {
    const state = derive({
      tasks: [task({ id: 'tsk_1', status: 'running' })],
      events: [event({ type: 'agent.session.turn.created', text: 'Employee started a turn.' })],
      posts: [handoffPost()],
    }).get(ada.id);
    expect(state?.activity).toBe('thinking');
  });

  it('drops the bubble once the message is a minute old', () => {
    const withMessage = (age: number) =>
      derive({
        tasks: [
          task({
            id: 'tsk_1',
            status: 'running',
            lastMessage: { text: 'Still reconciling the two lists.', createdAt: NOW - age },
          }),
        ],
      }).get(ada.id)?.bubble;
    expect(withMessage(BUBBLE_MS - 1_000)).toBe('Still reconciling the two lists.');
    expect(withMessage(BUBBLE_MS + 1_000)).toBeUndefined();
  });

  it('flags an approval only when this viewer can decide it', () => {
    const tasks = [task({ id: 'tsk_1', status: 'running' })];
    expect(derive({ tasks, proposals: [proposal()] }).get(ada.id)?.attention).toBe('approval');
    expect(derive({ tasks, proposals: [proposal({ canDecide: false })] }).get(ada.id)?.attention).toBe(
      undefined,
    );
    expect(derive({ tasks, proposals: [proposal({ status: 'approved' })] }).get(ada.id)?.attention).toBe(
      undefined,
    );
  });

  it('calls an approval stuck after thirty minutes', () => {
    const waiting = (age: number) => task({ id: 'tsk_1', status: 'awaiting_approval', updatedAt: NOW - age });
    expect(derive({ tasks: [waiting(STUCK_MS + 1_000)] }).get(ada.id)?.attention).toBe('stuck');
    expect(derive({ tasks: [waiting(STUCK_MS - 1_000)] }).get(ada.id)?.attention).toBeUndefined();
  });

  it('picks the most recent active task when an employee has several', () => {
    const state = derive({
      tasks: [
        task({ id: 'tsk_old', status: 'running', updatedAt: NOW - 900_000 }),
        task({ id: 'tsk_new', status: 'awaiting_approval', updatedAt: NOW - 2_000 }),
      ],
    }).get(ada.id);
    expect(state).toMatchObject({ activity: 'reviewing', taskId: 'tsk_new' });
  });

  it('ignores another employee’s work', () => {
    const states = derive({
      tasks: [task({ id: 'tsk_1', status: 'running' })],
      events: [event({ type: 'agent.session.turn.created', text: 'Employee started a turn.' })],
    });
    expect(states.get(bo.id)?.activity).toBe('idle');
  });
});

describe('bubble text', () => {
  it('keeps the first sentence and ellipsizes anything longer than the limit', () => {
    expect(firstSentence('One. Two. Three.')).toBe('One.');
    expect(firstSentence('No terminator here')).toBe('No terminator here');
    expect(firstSentence('x'.repeat(200))).toHaveLength(90);
    expect(firstSentence('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});

describe('providerForTool', () => {
  it('matches a provider prefix and nothing else', () => {
    expect(providerForTool('slack_post_message')).toBe('slack');
    expect(providerForTool('google-workspace.gmail_draft')).toBe('google-workspace');
    expect(providerForTool('google_workspace_drive_list')).toBe('google-workspace');
    expect(providerForTool('astra_floor_post')).toBeUndefined();
  });
});

function calendarEntry(
  overrides: Partial<CalendarEntry> & Pick<CalendarEntry, 'id' | 'kind'>,
): CalendarEntry {
  return {
    title: 'September release review',
    startsAt: NOW,
    endsAt: NOW + 1_800_000,
    attendees: [{ kind: 'employee', id: ada.id, name: ada.name }],
    agenda: [],
    status: 'scheduled',
    ...overrides,
  };
}

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id: 'fnd_1',
    employeeId: ada.id,
    employeeName: ada.name,
    auditDate: '2026-09-11',
    severity: 'medium',
    claim: 'The report says the tests pass; the journal has no test run.',
    evidence: 'No tool call in the journal.',
    requiredAction: 'Run the tests and post the output.',
    status: 'open',
    createdAt: NOW - 40_000_000,
    updatedAt: NOW - 40_000_000,
    ...overrides,
  };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alr_1',
    source: 'github',
    fingerprint: 'checkout-500',
    severity: 'high',
    title: 'Checkout is returning 500 for card payments.',
    detail: 'Five reports in ten minutes.',
    status: 'triaging',
    affectedFloorIds: ['prj_1'],
    occurrences: 5,
    paging: { attempts: 0, required: 3, acknowledged: false },
    createdAt: NOW - 120_000,
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

const schedule: ScheduleSummary = {
  timezone: 'Europe/London',
  workingDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
  attendedStartHour: 9,
  attendedEndHour: 18,
  overnightPolicy: 'cheap',
  working: false,
  attended: false,
  usageToday: { input: 0, output: 0, cached: 0, cap: 0 },
};

describe('the day around the desk', () => {
  it('walks an attendee to the meeting an hour before it starts', () => {
    const state = derive({
      day: { meetings: [{ entry: calendarEntry({ id: 'cal_1', kind: 'meeting', startsAt: NOW + 600_000 }) }] },
    }).get(ada.id);
    expect(state?.activity).toBe('preparing');
  });

  it('gives the floor to whoever answered last, and the question to whoever was asked', () => {
    const entry = calendarEntry({ id: 'cal_1', kind: 'meeting', status: 'live' });
    const meeting: Meeting = {
      id: 'mtg_1',
      calendarEntryId: 'cal_1',
      status: 'live',
      turns: [
        {
          id: 'trn_1',
          kind: 'answer',
          authorName: ada.name,
          employeeId: ada.id,
          text: 'The changelog is signed off. The pricing page is not.',
          createdAt: NOW - 10_000,
        },
      ],
    };
    expect(derive({ day: { meetings: [{ entry, meeting }] } }).get(ada.id)).toMatchObject({
      activity: 'presenting',
      bubble: 'The changelog is signed off.',
    });

    const asked: Meeting = {
      ...meeting,
      turns: [
        ...meeting.turns,
        {
          id: 'trn_2',
          kind: 'question',
          authorName: 'Sam',
          addressedTo: [ada.id],
          text: 'When does pricing land?',
          createdAt: NOW - 5_000,
        },
      ],
    };
    expect(derive({ day: { meetings: [{ entry, meeting: asked }] } }).get(ada.id)?.activity).toBe(
      'answering',
    );
  });

  it('runs a triage session to the console, carrying the alert', () => {
    const state = derive({
      tasks: [task({ id: 'tsk_t', status: 'running', kind: 'triage' })],
      day: { alerts: [alert({ triageTaskId: 'tsk_t' })] },
    }).get(ada.id);
    expect(state).toMatchObject({ activity: 'triaging', alertId: 'alr_1' });
  });

  it('sends an auditor to the desk of whoever the night found something on', () => {
    const state = derive({
      employees: [bo, ada],
      tasks: [task({ id: 'tsk_a', status: 'running', kind: 'audit', employeeId: bo.id })],
      day: { findings: [finding()] },
    }).get(bo.id);
    expect(state).toMatchObject({ activity: 'auditing', visitingId: ada.id });
  });

  it('sends an auditor only to a desk in this room, and only for an open finding', () => {
    const audit = task({ id: 'tsk_a', status: 'running', kind: 'audit', employeeId: bo.id });
    const away = finding({ id: 'fnd_away', employeeId: 'emp_elsewhere', createdAt: NOW - 1_000 });
    const closed = finding({ id: 'fnd_closed', status: 'addressed', createdAt: NOW - 2_000 });
    const state = derive({
      employees: [bo, ada],
      tasks: [audit],
      day: { findings: [away, closed, finding()] },
    }).get(bo.id);
    expect(state).toMatchObject({ activity: 'auditing', visitingId: ada.id });
    expect(
      derive({ employees: [bo, ada], tasks: [audit], day: { findings: [away, closed] } }).get(bo.id),
    ).not.toHaveProperty('visitingId');
  });

  it('files the janitor at the binder during a curation run', () => {
    const state = derive({
      tasks: [task({ id: 'tsk_c', status: 'running', kind: 'curation' })],
    }).get(ada.id);
    expect(state?.activity).toBe('filing');
  });

  it('puts a planning turn at the task board', () => {
    const state = derive({ tasks: [task({ id: 'tsk_p', status: 'running', kind: 'standing' })] }).get(ada.id);
    expect(state?.activity).toBe('planning');
  });

  it('reads the memory tools as memory, not as another provider call', () => {
    const state = derive({
      tasks: [task({ id: 'tsk_1', status: 'running' })],
      events: [event({ type: 'tool_call', text: 'astra_memory_remember: started' })],
    }).get(ada.id);
    expect(state).toMatchObject({ activity: 'remembering', tool: 'astra_memory_remember' });
  });

  it('runs a string from a waiting task to the dependency it is waiting on', () => {
    const state = derive({
      tasks: [
        task({ id: 'tsk_2', status: 'waiting', dependsOn: ['tsk_1'] }),
        task({ id: 'tsk_1', status: 'running', employeeId: bo.id }),
      ],
    }).get(ada.id);
    expect(state).toMatchObject({ activity: 'waiting', waitingOn: 'tsk_1' });
  });

  it('leaves an idle employee with an open finding uneasy', () => {
    expect(derive({ day: { findings: [finding()] } }).get(ada.id)?.activity).toBe('uneasy');
  });

  it('reads the edges of a shift as arriving and leaving, and the rest of the night as off shift', () => {
    const shifts = [{ employeeId: ada.id, startedAt: NOW - 60_000, endedAt: NOW + 600_000 }];
    expect(derive({ day: { shifts } }).get(ada.id)?.activity).toBe('arriving');
    // The shift's own task is queued from the moment it opens, so arriving has to
    // outrank the journal or nobody would ever be seen walking in.
    expect(
      derive({
        tasks: [task({ id: 'tsk_1', status: 'running' })],
        day: { shifts },
      }).get(ada.id)?.activity,
    ).toBe('arriving');
    expect(
      derive({ day: { shifts: [{ employeeId: ada.id, startedAt: NOW - 3_600_000, endedAt: NOW - 60_000 }] } }).get(
        ada.id,
      )?.activity,
    ).toBe('leaving');
    expect(derive({ day: { schedule } }).get(ada.id)?.activity).toBe('off_shift');
  });

  it('calls end-of-day writing a report rather than task output', () => {
    const state = derive({
      tasks: [
        task({
          id: 'tsk_1',
          status: 'running',
          lastMessage: { text: 'Done for today: the changelog.', createdAt: NOW - 1_000 },
        }),
      ],
      day: { schedule, shifts: [{ employeeId: ada.id, taskId: 'tsk_1', startedAt: NOW - 3_600_000 }] },
    }).get(ada.id);
    expect(state?.activity).toBe('reporting');
  });

  it('takes the calendar shift blocks as the shifts', () => {
    const shifts = shiftsFromCalendar([
      calendarEntry({ id: 'cal_s', kind: 'shift', taskId: 'tsk_1' }),
      calendarEntry({ id: 'cal_m', kind: 'meeting' }),
    ]);
    expect(shifts).toEqual([
      { employeeId: ada.id, taskId: 'tsk_1', startedAt: NOW, endedAt: NOW + 1_800_000 },
    ]);
  });
});

describe('isWorking', () => {
  it('separates the people a desk lamp belongs to from the ones it does not', () => {
    for (const activity of ['thinking', 'auditing', 'triaging', 'filing', 'reporting'] as const)
      expect(isWorking(activity), activity).toBe(true);
    for (const activity of ['idle', 'off_shift', 'leaving', 'waiting', 'blocked', 'uneasy'] as const)
      expect(isWorking(activity), activity).toBe(false);
  });
});

describe('deriveFloorSignals', () => {
  it('lights the beacon for an open alert that reaches this floor, and not another one', () => {
    expect(deriveFloorSignals({ alerts: [alert()] }, 'prj_1', NOW)).toMatchObject({
      incident: true,
      incidentCount: 1,
    });
    expect(deriveFloorSignals({ alerts: [alert()] }, 'prj_2', NOW).incident).toBe(false);
  });

  it('carries the notice once three attempts to reach a person went unanswered', () => {
    const notice = {
      id: 'ntf_1',
      kind: 'triage' as const,
      title: 'Deployed the checkout fix without approval.',
      text: 'Three attempts, no answer.',
      attempt: 3,
      sentAt: NOW - 60_000,
    };
    expect(deriveFloorSignals({ notifications: [notice] }, undefined, NOW).emergency).toMatchObject({
      title: 'Deployed the checkout fix without approval.',
    });
    expect(
      deriveFloorSignals({ notifications: [{ ...notice, attempt: 2 }] }, undefined, NOW).emergency,
    ).toBeUndefined();
  });

  it('counts open findings per employee for the folder on the desk', () => {
    const signals = deriveFloorSignals(
      { findings: [finding(), finding({ id: 'fnd_2' }), finding({ id: 'fnd_3', status: 'verified' })] },
      undefined,
      NOW,
    );
    expect(signals.findings.get(ada.id)).toBe(2);
  });
});
