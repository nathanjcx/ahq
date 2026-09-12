import { describe, expect, it } from 'vitest';
import type { ActionProposal, ActivityEvent, ProjectPost, Task } from '../lib/contracts';
import {
  BUBBLE_MS,
  CELEBRATING_MS,
  FAILED_MS,
  READING_MS,
  STUCK_MS,
  deriveActivities,
  firstSentence,
  providerForTool,
  type ActivityInput,
} from '../components/office/activity';

const NOW = 1_700_000_000_000;
const ada = { id: 'emp_ada', name: 'Ada' };
const bo = { id: 'emp_bo', name: 'Bo' };

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  return {
    projectId: 'prj_1',
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

function handoffPost(overrides: Partial<ProjectPost> = {}): ProjectPost {
  return {
    id: 'pst_1',
    projectId: 'prj_1',
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
