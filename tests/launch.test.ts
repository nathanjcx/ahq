import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'node:test';
import { LaunchCoordinator, type LaunchDependencies } from '../desktop/launch';
import type { DemoNotification, LocalTaskInput } from '../shared/demo';
import type { LaunchSceneId, LaunchStep } from '../shared/launch';
import type { AppState, CloudSession, Commitment } from '../shared/types';
import { initialState } from '../src/lib/store';

const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), 'launch-test-'));
  workspaces.push(workspace);
  writeFileSync(path.join(workspace, 'forecast.csv'), 'month,customers,price_usd\n2026-10,120,12');
  writeFileSync(path.join(workspace, 'little-office-launch-bug.png'), 'actual capture fixture');
  let state = initialState();
  let stored: unknown;
  let triggerCount = 0;
  let restored: AppState | undefined;
  const sessions = new Map<string, CloudSession>();
  const notifications: DemoNotification[] = [];
  const artifact = (id: string, content = id): CloudSession => ({
    id,
    workspace,
    status: 'completed',
    reviewed: true,
    activity: 'Done',
    location: 'desk',
    events: [],
    artifacts: [{ id, title: id, kind: 'report', filePath: `/tmp/${id}.md`, content, simulated: true }],
  });
  const commitment = (step: LaunchStep, sessionId: string): Commitment => ({
    id: `task-${step}`,
    launchId: state.roadmap?.launchId,
    launchStep: step,
    sessionId,
    taskKind:
      step === 'product'
        ? 'product'
        : step === 'bug'
          ? 'bug'
          : step === 'reporter' || step === 'marketing'
            ? 'meeting'
            : 'report',
    title: step,
    description: step,
    ownerId: step,
    recipient: 'You',
    deadline: '2026-10-01',
    firm: false,
    status: 'done',
    progress: 100,
    nextStep: 'Reviewed and approved',
    dependencies: [],
    source: 'launch',
    definitionOfDone: 'Verified artifact',
  });
  const deps: LaunchDependencies = {
    load: async () => structuredClone(state),
    restoreState: async (value) => {
      restored = structuredClone(value);
      state = structuredClone(value);
    },
    store: {
      get: async <T>() => structuredClone(stored) as T | undefined,
      put: async <T>(_key: string, value: T) => {
        stored = structuredClone(value);
      },
    },
    queue: async (work) => work(),
    createGoal: async (_goal, launchId) => {
      state = {
        ...state,
        roadmap: {
          id: 'roadmap',
          launchId,
          goal: 'Launch Little Office',
          status: 'active',
          message: 'Working',
          createdAt: new Date().toISOString(),
          milestoneIds: [],
          assignments: [],
        },
      };
      return structuredClone(state);
    },
    trigger: async (input, task) => {
      triggerCount++;
      const id = `notification-${task.launchStep}-${triggerCount}`;
      const session = artifact(`session-${task.launchStep}`);
      const triage = artifact(`triage-${task.launchStep}`);
      sessions.set(session.id, session);
      sessions.set(triage.id, triage);
      state.commitments.push(commitment(task.launchStep, session.id));
      const notification: DemoNotification = {
        ...input,
        title: input.title!,
        content: input.content!,
        attachments: input.attachments!,
        id,
        receivedAt: new Date().toISOString(),
        status: 'completed',
        triageSessionId: `triage-${task.launchStep}`,
        sessionId: session.id,
      };
      notifications.push(notification);
      return structuredClone(notification);
    },
    retryLaunch: async () => {},
    demoSnapshot: async () => ({
      notifications: structuredClone(notifications),
      sessions: [...sessions.values()].map((session) => structuredClone(session)),
    }),
    getSession: async (id) => structuredClone(sessions.get(id)!),
    validateArtifacts: async (session) => !!session.artifacts?.length,
  };
  const coordinator = new LaunchCoordinator(deps);
  const completeInitialWork = async () => {
    const launchId = (await coordinator.snapshot()).id;
    for (const step of ['product', 'marketing', 'forecast'] as const) {
      const session = artifact(
        `session-${step}`,
        step === 'forecast' ? 'month,customers,price_usd\n2026-10,120,12' : step,
      );
      sessions.set(session.id, session);
      state.commitments.push({ ...commitment(step, session.id), launchId });
    }
    await coordinator.tick();
  };
  return {
    coordinator,
    deps,
    sessions,
    notifications,
    completeInitialWork,
    state: () => state,
    setState: (value: AppState) => {
      state = value;
    },
    triggerCount: () => triggerCount,
    restored: () => restored,
  };
}

test('plays each source-linked scene from verified artifacts and celebrates only at roadmap completion', async () => {
  const f = fixture();
  const started = await f.coordinator.start();
  assert.equal(started.scenes[0].status, 'running');
  await f.completeInitialWork();
  assert.equal((await f.coordinator.snapshot()).scenes[1].status, 'ready');

  for (const id of ['investor', 'bug', 'reporter'] as LaunchSceneId[]) {
    const running = await f.coordinator.advance(id);
    assert.equal(running.scenes.find((scene) => scene.id === id)?.status, 'running');
    await f.coordinator.tick();
  }
  const beforeCelebrate = await f.coordinator.snapshot();
  assert.equal(beforeCelebrate.scenes[4].status, 'ready');
  assert.equal(f.triggerCount(), 3);
  await assert.rejects(f.coordinator.advance('celebrate'), /roadmap is not complete/);

  f.setState({ ...f.state(), roadmap: { ...f.state().roadmap!, status: 'complete' } });
  const completed = await f.coordinator.advance('celebrate');
  assert.equal(completed.status, 'completed');
  assert.ok(completed.celebrationId);
  assert.ok(completed.scenes.slice(0, 4).every((scene) => scene.notificationId || scene.id === 'launch'));
});

test('investor input identifies fiction, the action, original forecast, and numerical reduction', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  await f.coordinator.advance('investor');
  const email = f.notifications[0];
  assert.match(email.title, /\[ACTION\]/);
  assert.match(email.content, /fictional investor/);
  assert.ok(email.attachments.some((file) => file.name === 'original-forecast.csv'));
  assert.ok(!email.attachments.some((file) => file.name === 'forecast-contract.json'));
  assert.ok(email.attachments.some((file) => file.name.startsWith('forecast-')));
  const scenario = email.attachments.find((file) => file.name === 'competitor-scenario.csv')!.content;
  assert.match(scenario, /0\.15,0\.09/);
  assert.match(scenario, /6 percentage points/);
});

test('checkpoint restore reuses completed sessions and refuses active work', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  const checkpoint = (await f.coordinator.snapshot()).checkpoints[0];
  await f.coordinator.advance('investor');
  await f.coordinator.tick();
  const restored = await f.coordinator.restore(checkpoint.id);
  assert.equal(restored.scenes[1].status, 'ready');
  assert.equal(f.triggerCount(), 1);
  assert.ok(f.restored());

  f.sessions.get('session-product')!.status = 'running';
  await assert.rejects(f.coordinator.restore(checkpoint.id), /Wait for launch work to stop/);
});

test('start is idempotent while the story is running', async () => {
  const f = fixture();
  const first = await f.coordinator.start();
  const second = await f.coordinator.start();
  assert.equal(second.id, first.id);
  assert.equal(second.scenes[0].status, 'running');
});

test('idle snapshots are stable and advance launch creates the genuine plan', async () => {
  const f = fixture();
  assert.equal((await f.coordinator.snapshot()).id, (await f.coordinator.snapshot()).id);
  const started = await f.coordinator.advance('launch');
  assert.equal(f.state().roadmap?.launchId, started.id);
});

test('a restored scene dispatches a new notification while retaining prior history', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  const checkpoint = (await f.coordinator.snapshot()).checkpoints[0];
  await f.coordinator.advance('investor');
  await f.coordinator.tick();
  const first = f.notifications[0];
  await f.coordinator.restore(checkpoint.id);
  await f.coordinator.advance('investor');
  assert.equal(f.notifications.length, 2);
  assert.notEqual(f.notifications[1].idempotencyKey, first.idempotencyKey);
  assert.equal(f.notifications[0].id, first.id);
});

test('restore checks pending source work even before the scene has reconciled', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  const checkpoint = (await f.coordinator.snapshot()).checkpoints[0];
  await f.coordinator.advance('investor');
  f.notifications[0].status = 'working';
  await assert.rejects(f.coordinator.restore(checkpoint.id), /Wait for launch work to stop/);
  f.notifications[0].status = 'completed';
  f.sessions.get('session-revision')!.status = 'waiting_for_approval';
  await assert.rejects(f.coordinator.restore(checkpoint.id), /Wait for launch work to stop/);
});

test('review and artifact validation gate the initial handoff and launch retry invokes the runtime', async () => {
  const f = fixture();
  await f.coordinator.start();
  f.deps.validateArtifacts = async () => false;
  await f.completeInitialWork();
  assert.equal((await f.coordinator.snapshot()).scenes[0].status, 'failed');
  await assert.rejects(f.coordinator.advance('investor'), /not ready/);
  let retried = '';
  f.deps.retryLaunch = async (id) => {
    retried = id;
  };
  const retry = await f.coordinator.retry('launch');
  assert.equal(retried, retry.id);
  assert.equal(retry.scenes[0].status, 'running');
  f.deps.validateArtifacts = async () => true;
  await f.coordinator.tick();
  assert.equal((await f.coordinator.snapshot()).scenes[1].status, 'ready');
});

test('a failed source dispatch can retry and the bug receives the real product lineage', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  const trigger = f.deps.trigger;
  f.deps.trigger = async () => {
    throw new Error('source unavailable');
  };
  assert.equal((await f.coordinator.advance('investor')).scenes[1].status, 'failed');
  f.deps.trigger = trigger;
  assert.equal((await f.coordinator.retry('investor')).scenes[1].status, 'running');
  await f.coordinator.tick();
  let task: LocalTaskInput | undefined;
  f.deps.trigger = async (input, context) => {
    task = context;
    return trigger(input, context);
  };
  await f.coordinator.advance('bug');
  assert.equal(task?.parentSessionId, 'session-product');
  assert.equal(task?.parentWorkspace, f.sessions.get('session-product')!.workspace);
  assert.match(f.notifications[1].content, /960 by 720/);
  assert.ok(task?.files.some((file) => file.encoding === 'base64' && file.mediaType === 'image/png'));
});

test('celebration revalidates every deliverable and restores produce a new celebration event', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  for (const id of ['investor', 'bug', 'reporter'] as const) {
    await f.coordinator.advance(id);
    await f.coordinator.tick();
  }
  f.setState({ ...f.state(), roadmap: { ...f.state().roadmap!, status: 'complete' } });
  f.sessions.get('session-marketing')!.reviewed = false;
  await assert.rejects(f.coordinator.advance('celebrate'), /verification/);
  f.sessions.get('session-marketing')!.reviewed = true;
  const completed = await f.coordinator.advance('celebrate');
  const checkpoint = completed.checkpoints.find(
    (item) => item.label === 'Prepare for the reporter meeting complete',
  )!;
  await f.coordinator.restore(checkpoint.id);
  f.setState({ ...f.state(), roadmap: { ...f.state().roadmap!, status: 'complete' } });
  const retake = await f.coordinator.advance('celebrate');
  assert.notEqual(retake.celebrationId, completed.celebrationId);
});

test('dispatch retries reuse the durable source key after a transport failure', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  const trigger = f.deps.trigger;
  let key: string | undefined;
  f.deps.trigger = async (input) => {
    key = input.idempotencyKey;
    throw new Error('transport lost before acknowledgement');
  };
  await f.coordinator.advance('investor');
  f.deps.trigger = async (input, context) => {
    assert.equal(input.idempotencyKey, key);
    return trigger(input, context);
  };
  assert.equal((await f.coordinator.retry('investor')).scenes[1].status, 'running');
});

test('failed notifications retry through the source coordinator', async () => {
  const f = fixture();
  await f.coordinator.start();
  await f.completeInitialWork();
  await f.coordinator.advance('investor');
  f.notifications[0].status = 'failed';
  await f.coordinator.tick();
  f.deps.retryNotification = async (id) => {
    assert.equal(id, f.notifications[0].id);
    f.notifications[0].status = 'completed';
    return structuredClone(f.notifications[0]);
  };
  assert.equal((await f.coordinator.retry('investor')).scenes[1].status, 'running');
  await f.coordinator.tick();
  assert.equal((await f.coordinator.snapshot()).scenes[2].status, 'ready');
  assert.equal(f.triggerCount(), 1);
});
