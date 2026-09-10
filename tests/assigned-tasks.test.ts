import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, CloudSession, RoadmapRun } from '../shared/types';
import { SessionSchema, StateSchema } from '../shared/schemas';
import { initialState, sampleState } from '../src/lib/store';
import { assertCanAssignTask, recordAssignedTask } from '../src/lib/assignedTasks';
import { applyDecision, applySession } from '../src/lib/workflow';

function workspace(): AppState {
  return {
    ...initialState(),
    employees: [{ ...sampleState().employees[1], id: 'employee', status: 'ready' }],
  };
}

function runningSession(): CloudSession {
  return {
    id: 'chatgpt-manual-assignment',
    status: 'running',
    activity: 'Writing the release notes.',
    location: 'desk',
    events: [{ id: 'started', text: 'I have started the release notes.', time: new Date().toISOString() }],
  };
}

function withRoadmap(status: RoadmapRun['status']): AppState {
  const state = workspace();
  const commitment = { ...sampleState().commitments[2], ownerId: 'employee', dependencies: [] };
  return {
    ...state,
    commitments: [commitment],
    roadmap: {
      id: crypto.randomUUID(),
      goal: state.goal,
      status,
      message: `Existing ${status} message`,
      createdAt: new Date().toISOString(),
      milestoneIds: [commitment.id],
      assignments: [],
    },
  };
}

test('a confirmed task immediately appears on the roadmap and in the employee conversation', () => {
  const state = workspace();
  const session = runningSession();
  const assignment = 'Write the release notes\nExplain the changes in plain language.';
  const result = recordAssignedTask(state, 'employee', assignment, session);
  const task = result.commitments[0];
  assert.equal(task.title, 'Write the release notes');
  assert.equal(task.description, assignment);
  assert.equal(task.assignment, assignment);
  assert.equal(task.ownerId, 'employee');
  assert.equal(task.recipient, 'You');
  assert.equal(task.deadline, '');
  assert.equal(task.firm, false);
  assert.equal(task.status, 'in-progress');
  assert.equal(task.progress, 10);
  assert.equal(task.sessionId, session.id);
  assert.equal(task.nextStep, session.activity);
  assert.equal(task.source, 'Assigned by you');
  assert.deepEqual(task.dependencies, []);
  assert.equal(result.roadmap, undefined);
  assert.equal(result.employees[0].status, 'working');
  assert.equal(result.employees[0].sessionId, session.id);
  assert.equal(result.messages.find((item) => item.authorId === 'you')?.text, assignment);
  assert.equal(result.messages.find((item) => item.authorId === 'you')?.channel, 'employee');
  assert.match(result.events.find((item) => item.source === 'local')!.text, /Assigned.*Leo/);
  assert.equal(StateSchema.safeParse(result).success, true);
  assert.equal(state.commitments.length, 0);
  assert.equal(state.messages.length, 0);
});

for (const status of ['active', 'paused', 'planning', 'failed'] as const) {
  test(`manual work is visible while preserving a ${status} roadmap and its existing claims`, () => {
    const state = withRoadmap(status);
    state.roadmap!.assignments = [
      { commitmentId: state.commitments[0].id, employeeId: 'another-employee', status: 'stopped' },
    ];
    const result = recordAssignedTask(state, 'employee', 'Write the release notes', runningSession());
    assert.equal(result.roadmap!.status, status);
    assert.equal(result.roadmap!.message, state.roadmap!.message);
    assert.equal(result.roadmap!.goal, state.roadmap!.goal);
    assert.equal(result.roadmap!.id, state.roadmap!.id);
    assert.deepEqual(result.roadmap!.assignments, state.roadmap!.assignments);
    assert.deepEqual(result.commitments[0], state.commitments[0]);
    assert.deepEqual(result.roadmap!.milestoneIds, [state.commitments[0].id, result.commitments[1].id]);
  });
}

test('adding manual work to a complete roadmap leaves automatic delegation paused', () => {
  const state = withRoadmap('complete');
  const result = recordAssignedTask(state, 'employee', 'Write the release notes', runningSession());
  assert.equal(result.roadmap!.status, 'paused');
  assert.equal(result.roadmap!.message, 'This task is being tracked. Automatic delegation is paused.');
  assert.deepEqual(result.roadmap!.assignments, []);
  assert.deepEqual(result.commitments[0], state.commitments[0]);
});

test('repeated responses do not duplicate tasks, assignment messages, or activity', () => {
  const session = runningSession();
  const first = recordAssignedTask(withRoadmap('active'), 'employee', 'Write the release notes', session);
  const second = recordAssignedTask(
    JSON.parse(JSON.stringify(first)),
    'employee',
    'A retry cannot replace the original assignment',
    session,
  );
  assert.deepEqual(second, first);
  assert.equal(second.commitments.filter((item) => item.sessionId === session.id).length, 1);
  assert.equal(second.messages.filter((item) => item.authorId === 'you').length, 1);
  assert.equal(second.events.filter((item) => item.source === 'local').length, 1);
});

test('a long assignment remains intact while the roadmap preview stays concise', () => {
  const assignment = `  ${'A'.repeat(180)}\n${'Useful detail. '.repeat(750)}  `;
  const result = recordAssignedTask(workspace(), 'employee', assignment, runningSession());
  assert.equal(result.commitments[0].title.length, 120);
  assert.equal(result.commitments[0].description.length, 2000);
  assert.equal(result.commitments[0].assignment, assignment);
  assert.equal(result.messages.find((item) => item.authorId === 'you')?.text, assignment);
  assert.equal(StateSchema.safeParse(result).success, true);
});

test('confirmed manual work leaves example mode while failed validation preserves the workspace', () => {
  const state = { ...workspace(), demo: true };
  assert.equal(recordAssignedTask(state, 'employee', 'Write release notes', runningSession()).demo, false);
  assert.equal(state.demo, true);
  assert.throws(
    () => recordAssignedTask(state, 'missing', 'Write release notes', runningSession()),
    /no longer/,
  );
  assert.throws(() => recordAssignedTask(state, 'employee', ' ', runningSession()), /Describe the task/);
  assert.throws(() => recordAssignedTask(state, 'employee', 'A'.repeat(12001), runningSession()), /12,000/);
  assert.throws(
    () => recordAssignedTask(state, 'employee', 'Write release notes', { ...runningSession(), id: '' }),
    /confirmed session/,
  );
  assert.equal(state.commitments.length, 0);
});

test('a confirmed session cannot be linked to another employee by retrying', () => {
  const state = workspace();
  state.employees.push({ ...state.employees[0], id: 'other' });
  const assigned = recordAssignedTask(state, 'employee', 'Write release notes', runningSession());
  assert.throws(
    () => recordAssignedTask(assigned, 'other', 'A different task', runningSession()),
    /another employee/,
  );
});

test('workspace limits are checked before adding a confirmed task or its session events', () => {
  const session = runningSession();
  const task = sampleState().commitments[2];
  const message = {
    id: 'old',
    authorId: 'you',
    channel: 'team',
    text: 'Old',
    time: new Date().toISOString(),
  };
  const event = {
    id: 'old',
    text: 'Old',
    time: new Date().toISOString(),
    kind: 'work' as const,
    source: 'local' as const,
  };
  const fullStates = [
    {
      ...workspace(),
      commitments: Array.from({ length: 1000 }, (_, index) => ({ ...task, id: `task-${index}` })),
    },
    {
      ...withRoadmap('paused'),
      roadmap: {
        ...withRoadmap('paused').roadmap!,
        milestoneIds: Array.from({ length: 1000 }, (_, index) => `task-${index}`),
      },
    },
    {
      ...workspace(),
      messages: Array.from({ length: 9999 }, (_, index) => ({ ...message, id: `message-${index}` })),
    },
    {
      ...workspace(),
      events: Array.from({ length: 19999 }, (_, index) => ({ ...event, id: `event-${index}` })),
    },
  ];
  for (const state of fullStates) {
    const before = JSON.stringify(state);
    assert.throws(
      () => recordAssignedTask(state, 'employee', 'Write release notes', session),
      /workspace is full/,
    );
    assert.equal(JSON.stringify(state), before);
  }
  const result = recordAssignedTask(
    {
      ...workspace(),
      messages: Array.from({ length: 9499 }, (_, index) => ({ ...message, id: `message-${index}` })),
    },
    'employee',
    'Write release notes',
    session,
  );
  assert.equal(result.messages.length, 9501);
});

test('preflight reserves all 500 initial session events and one assignment entry at the exact limits', () => {
  const state = withRoadmap('active');
  const time = new Date().toISOString();
  state.messages = Array.from({ length: 9499 }, (_, index) => ({
    id: `message-${index}`,
    authorId: 'you',
    channel: 'team',
    text: 'An earlier message',
    time,
  }));
  state.events = Array.from({ length: 19499 }, (_, index) => ({
    id: `event-${index}`,
    text: 'Earlier activity',
    time,
    kind: 'work',
    source: 'local',
  }));
  const approval = sampleState().approvals[0];
  state.approvals = Array.from({ length: 999 }, (_, index) => ({
    ...approval,
    id: `approval-${index}`,
  }));
  const task = state.commitments[0];
  state.commitments = Array.from({ length: 999 }, (_, index) => ({
    ...task,
    id: `task-${index}`,
  }));
  state.roadmap!.milestoneIds = state.commitments.map((item) => item.id);
  const session: CloudSession = {
    ...runningSession(),
    status: 'waiting_for_approval',
    events: Array.from({ length: 500 }, (_, index) => ({
      id: `initial-${index}`,
      text: `Progress update ${index}`,
      time,
    })),
    output: { title: 'Release notes', content: '# Ready', sources: [], recipient: 'You', version: 1 },
  };
  assert.equal(SessionSchema.safeParse(session).success, true);
  assert.doesNotThrow(() => assertCanAssignTask(state));
  for (const field of ['messages', 'events'] as const) {
    const overLimit = { ...state, [field]: [...state[field], { ...state[field][0], id: 'one-too-many' }] };
    let started = false;
    assert.throws(() => {
      assertCanAssignTask(overLimit);
      started = true;
    }, /workspace is full/);
    assert.equal(started, false);
  }
  const result = recordAssignedTask(state, 'employee', 'Write release notes', session);
  assert.equal(result.messages.length, 10000);
  assert.equal(result.events.length, 20000);
  assert.equal(result.approvals.length, 1000);
  assert.equal(result.commitments.length, 1000);
  assert.equal(result.roadmap!.milestoneIds.length, 1000);
  assert.equal(StateSchema.safeParse(result).success, true);
  assert.deepEqual(recordAssignedTask(result, 'employee', 'Write release notes', session), result);
});

test('capacity preflight can reject a full workspace before any employee session starts', () => {
  const state = workspace();
  assert.doesNotThrow(() => assertCanAssignTask(state));
  state.approvals = Array.from({ length: 1000 }, (_, index) => ({
    ...sampleState().approvals[0],
    id: `approval-${index}`,
  }));
  let started = false;
  assert.throws(() => {
    assertCanAssignTask(state);
    started = true;
  }, /workspace is full/);
  assert.equal(started, false);
});

test('review, requested changes, and approval update the manually assigned roadmap task', () => {
  const session = runningSession();
  let state = recordAssignedTask(workspace(), 'employee', 'Write release notes', session);
  const ready: CloudSession = {
    ...session,
    status: 'waiting_for_approval',
    activity: 'The release notes are ready for review.',
    output: { title: 'Release notes', content: '# Release notes', sources: [], recipient: 'You', version: 1 },
  };
  state = applySession(state, 'employee', ready);
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.approvals[0].commitmentId, state.commitments[0].id);
  state = applyDecision(
    state,
    state.approvals[0].id,
    1,
    'changes-requested',
    'Explain the new task workflow.',
  );
  assert.equal(state.commitments[0].status, 'in-progress');
  const revised = { ...ready, output: { ...ready.output!, version: 2, content: '# Revised release notes' } };
  state = applySession(state, 'employee', revised);
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.approvals[1].commitmentId, state.commitments[0].id);
  state = applyDecision(state, state.approvals[1].id, 2, 'approved');
  assert.equal(state.commitments[0].status, 'done');
  assert.equal(state.commitments[0].progress, 100);
});

test('an immediate output is linked for review and never loses the assigned request', () => {
  const session: CloudSession = {
    ...runningSession(),
    status: 'waiting_for_approval',
    output: { title: 'Release notes', content: '# Ready', sources: [], recipient: 'You', version: 1 },
  };
  const state = recordAssignedTask(workspace(), 'employee', 'Write release notes', session);
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.approvals[0].commitmentId, state.commitments[0].id);
  assert.equal(state.commitments[0].assignment, 'Write release notes');
});
