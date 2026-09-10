import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { GoalCoordinator } from '../desktop/goals';
import type { AppState, Commitment } from '../shared/types';
import { initialState } from '../src/lib/store';
import { recordAssignedTask } from '../src/lib/assignedTasks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function milestone(id: string): Commitment {
  return {
    id,
    title: id,
    description: 'A concrete deliverable for review.',
    ownerId: '',
    recipient: 'You',
    deadline: '2026-09-11T12:00:00.000Z',
    firm: false,
    status: 'planned',
    progress: 0,
    nextStep: 'Make the first draft.',
    dependencies: [],
    source: 'AI goal roadmap',
    definitionOfDone: 'The user can review the finished draft.',
  };
}

function harness(input: AppState = initialState(), advanceError?: Error) {
  let state = structuredClone(input);
  let diskQueue = Promise.resolve();
  const saves: { state: AppState; reason?: string; checkpoint?: boolean }[] = [];
  const generated = new Map<string, ReturnType<typeof deferred<Commitment[]>>>();
  const advanced: AppState[] = [];
  function queue<T>(action: () => Promise<T>) {
    const task = diskQueue.then(action);
    diskQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  const coordinator = new GoalCoordinator({
    load: async () => structuredClone(state),
    save: async (next, reason, checkpoint) => {
      state = structuredClone(next);
      saves.push({ state: structuredClone(next), reason, checkpoint });
    },
    queue,
    generate: async (current) => {
      const pending = deferred<Commitment[]>();
      generated.set(current.goal, pending);
      return pending.promise;
    },
    advance: async (next) => {
      advanced.push(structuredClone(next));
      if (advanceError) throw advanceError;
      return next;
    },
  });
  return {
    coordinator,
    generated,
    saves,
    advanced,
    state: () => structuredClone(state),
    edit: (change: (current: AppState) => AppState) =>
      queue(async () => {
        state = change(state);
      }),
    settle: async () => {
      await setImmediate();
      await diskQueue;
    },
  };
}

test('creating a goal returns a durable planning state without occupying the disk queue', async () => {
  const run = harness();
  const result = await run.coordinator.create('Publish a useful field guide');
  assert.equal(result.roadmap?.status, 'planning');
  assert.equal(run.saves[0].checkpoint, true);
  assert.equal(run.saves[0].state.goal, initialState().goal);
  await run.edit((state) => ({ ...state, sound: true }));
  assert.equal(run.state().sound, true);
  assert.equal(run.advanced.length, 0);
  run.coordinator.close();
  run.generated.get(result.goal)!.resolve([milestone('guide')]);
  await run.settle();
});

test('a later goal wins when earlier AI generation completes after it', async () => {
  const run = harness();
  const first = await run.coordinator.create('First goal');
  const latest = await run.coordinator.create('Latest goal');
  assert.notEqual(first.roadmap?.id, latest.roadmap?.id);
  run.generated.get('Latest goal')!.resolve([milestone('latest-step')]);
  await run.settle();
  run.generated.get('First goal')!.resolve([milestone('obsolete-step')]);
  await run.settle();
  assert.equal(run.state().roadmap?.id, latest.roadmap?.id);
  assert.deepEqual(run.state().roadmap?.milestoneIds, ['latest-step']);
  assert.deepEqual(
    run.state().commitments.map((item) => item.id),
    ['latest-step'],
  );
  assert.equal(run.advanced.length, 1);
});

test('an obsolete generation failure cannot pause the newer roadmap', async () => {
  const run = harness();
  await run.coordinator.create('First goal');
  await run.coordinator.create('Latest goal');
  run.generated.get('Latest goal')!.resolve([milestone('latest-step')]);
  await run.settle();
  run.generated.get('First goal')!.reject(new Error('Old generation failed'));
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'active');
  assert.equal(
    run.state().events.some((event) => event.text.includes('Old generation failed')),
    false,
  );
});

test('generation failures persist a retryable failure while preserving existing office data', async () => {
  const original = { ...initialState(), commitments: [milestone('existing-work')] };
  const run = harness(original);
  await run.coordinator.create('A new goal');
  run.generated.get('A new goal')!.reject(new Error('Sign in with ChatGPT first.'));
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'failed');
  assert.equal(run.state().roadmap?.message, 'Sign in with ChatGPT first.');
  assert.deepEqual(run.state().commitments, original.commitments);
  assert.equal(run.advanced.length, 0);
  assert.match(run.saves.at(-1)!.state.events.at(-1)!.text, /Sign in with ChatGPT first/);
});

test('generation commits into the latest workspace and preserves historical and concurrent work', async () => {
  const run = harness({ ...initialState(), commitments: [milestone('prior-roadmap')] });
  await run.coordinator.create('A new goal');
  await run.edit((state) => ({
    ...state,
    reducedMotion: true,
    commitments: [...state.commitments, milestone('added-during-planning')],
    messages: [
      {
        id: 'concurrent-chat',
        authorId: 'you',
        channel: 'team',
        text: 'Keep this update.',
        time: '2026-09-10T12:00:00.000Z',
      },
    ],
  }));
  run.generated.get('A new goal')!.resolve([milestone('generated-step')]);
  await run.settle();
  const state = run.state();
  assert.equal(state.reducedMotion, true);
  assert.deepEqual(
    state.commitments.map((item) => item.id),
    ['prior-roadmap', 'added-during-planning', 'generated-step'],
  );
  assert.equal(
    state.messages.some((message) => message.id === 'concurrent-chat'),
    true,
  );
  assert.deepEqual(state.roadmap?.milestoneIds, ['generated-step']);
});

test('dispatch failures keep the generated roadmap available for recovery', async () => {
  const run = harness(initialState(), new Error('Connection needs attention.'));
  await run.coordinator.create('A new goal');
  run.generated.get('A new goal')!.resolve([milestone('generated-step')]);
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'paused');
  assert.equal(run.state().roadmap?.message, 'Connection needs attention.');
  assert.deepEqual(run.state().roadmap?.milestoneIds, ['generated-step']);
  assert.equal(run.state().commitments.length, 1);
});

test('existing and newly assigned tasks stay visible when AI generation completes', async () => {
  const existing = {
    ...milestone('existing-task'),
    status: 'in-progress' as const,
    sessionId: 'chatgpt-existing',
    assignment: 'Existing request',
  };
  const run = harness({ ...initialState(), commitments: [existing] });
  const planning = await run.coordinator.create('A new goal');
  assert.deepEqual(planning.roadmap?.milestoneIds, ['existing-task']);
  await run.edit((state) => ({
    ...state,
    employees: [
      {
        id: 'employee',
        name: 'Alex',
        jobTitle: 'Writer',
        personality: '',
        skills: 'Astra session',
        color: '#123456',
        avatar: 1,
        status: 'ready',
        activity: 'Ready',
        location: 'desk',
      },
    ],
  }));
  await run.edit((state) =>
    recordAssignedTask(state, 'employee', 'Write a launch note', {
      id: 'chatgpt-concurrent',
      status: 'running',
      activity: 'Writing a launch note',
      location: 'desk',
      events: [],
    }),
  );
  const manualId = run.state().commitments.find((c) => c.sessionId === 'chatgpt-concurrent')!.id;
  run.generated.get('A new goal')!.resolve([milestone('generated-step')]);
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'active');
  assert.deepEqual(run.state().roadmap?.milestoneIds, ['existing-task', manualId, 'generated-step']);
  assert.deepEqual(run.advanced[0].roadmap?.milestoneIds, ['existing-task', manualId, 'generated-step']);
  assert.equal(run.state().commitments.find((c) => c.id === manualId)?.sessionId, 'chatgpt-concurrent');
});

test('failed generation stays retryable even when assigned work is visible', async () => {
  const task = {
    ...milestone('manual-task'),
    sessionId: 'chatgpt-running',
    assignment: 'Current request',
    status: 'in-progress' as const,
  };
  const run = harness({ ...initialState(), commitments: [task] });
  await run.coordinator.create('A new goal');
  run.generated.get('A new goal')!.reject(new Error('Connection interrupted.'));
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'failed');
  assert.deepEqual(run.state().roadmap?.milestoneIds, ['manual-task']);
  assert.deepEqual(run.state().commitments, [task]);
});

test('closing the coordinator prevents a late generation from starting employee work', async () => {
  const run = harness();
  await run.coordinator.create('A new goal');
  run.coordinator.close();
  run.generated.get('A new goal')!.resolve([milestone('late-step')]);
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'planning');
  assert.equal(run.state().commitments.length, 0);
  assert.equal(run.advanced.length, 0);
});

test('concurrent milestones cannot make the generated plan exceed the stored workspace limit', async () => {
  const run = harness({
    ...initialState(),
    commitments: Array.from({ length: 980 }, (_, index) => milestone(`old-${index}`)),
  });
  await run.coordinator.create('A new goal');
  await run.edit((state) => ({
    ...state,
    commitments: [...state.commitments, milestone('concurrent-step')],
  }));
  run.generated
    .get('A new goal')!
    .resolve(Array.from({ length: 20 }, (_, index) => milestone(`new-${index}`)));
  await run.settle();
  assert.equal(run.state().roadmap?.status, 'failed');
  assert.match(run.state().roadmap!.message, /not enough room/);
  assert.equal(run.state().commitments.length, 981);
  assert.equal(
    run.saves.every((save) => save.state.commitments.length <= 1000),
    true,
  );
  assert.equal(run.advanced.length, 0);
});
