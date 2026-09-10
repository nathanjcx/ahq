import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoCoordinator, type DemoRecord, type DemoDependencies } from '../desktop/demo';
import { initialState } from '../src/lib/store';
import type { CloudSession } from '../shared/types';

function fixture() {
  let state = initialState();
  let records: DemoRecord[] = [];
  let count = 0;
  let valid = true;
  const sessions = new Map<string, CloudSession>();
  const deps: DemoDependencies = {
    load: async () => structuredClone(state),
    save: async (value) => {
      state = structuredClone(value);
    },
    store: {
      load: async () => structuredClone(records),
      save: async (value) => {
        records = structuredClone(value);
      },
    },
    queue: async (work) => work(),
    start: async (_employee, _assignment, _state, task) => {
      assert.equal(records.at(-1)?.dispatch, task.kind === 'triage' ? 'triage' : 'task');
      const session: CloudSession = {
        id: `chatgpt-${++count}`,
        status: 'running',
        activity: 'Working',
        location: 'desk',
        events: [],
      };
      sessions.set(session.id, session);
      return structuredClone(session);
    },
    get: async (id) => structuredClone(sessions.get(id)!),
    decide: async (id) => {
      const session = sessions.get(id)!;
      session.status = 'completed';
      session.reviewed = true;
      return structuredClone(session);
    },
    validateArtifacts: async () => valid,
  };
  const coordinator = new DemoCoordinator(deps);
  const review = (id: string, content: string) =>
    Object.assign(sessions.get(id)!, {
      status: 'waiting_for_approval',
      output: { title: 'Result', content, version: 1, sources: [], recipient: 'You' },
    });
  return {
    coordinator,
    deps,
    review,
    sessions,
    state: () => state,
    records: () => records,
    count: () => count,
    invalidate: () => {
      valid = false;
    },
  };
}
const decision = JSON.stringify({
  action: 'create',
  kind: 'report',
  title: 'Sales report',
  goal: 'Create the PDF.',
});

test('durable trigger replay and approved artifacts complete ordinary assigned tasks', async () => {
  const f = fixture();
  const first = await f.coordinator.trigger({ kind: 'email', idempotencyKey: 'take-1' });
  assert.equal((await f.coordinator.trigger({ kind: 'email', idempotencyKey: 'take-1' })).id, first.id);
  assert.equal(f.count(), 1);
  f.review(first.triageSessionId!, decision);
  await f.coordinator.tick();
  assert.equal(f.count(), 2);
  const task = f.records()[0].sessionId!;
  f.review(task, 'Created report.pdf');
  await f.coordinator.tick();
  assert.equal(f.records()[0].status, 'completed');
  assert.equal(f.state().commitments.find((c) => c.sessionId === task)?.status, 'done');
  assert.equal(f.state().employees.length, 2);
});

test('prose without a valid artifact fails without approval', async () => {
  const f = fixture();
  const first = await f.coordinator.trigger({ kind: 'email' });
  f.review(first.triageSessionId!, decision);
  await f.coordinator.tick();
  const task = f.records()[0].sessionId!;
  f.review(task, 'All done.');
  f.invalidate();
  await f.coordinator.tick();
  assert.equal(f.records()[0].status, 'failed');
  assert.equal(f.sessions.get(task)?.reviewed, undefined);
});

test('unknown attachment target cannot dispatch another task', async () => {
  const f = fixture();
  const first = await f.coordinator.trigger({ kind: 'slack' });
  f.review(
    first.triageSessionId!,
    JSON.stringify({ action: 'attach', kind: 'bug', title: 'Bug', goal: 'Fix', sessionId: 'unknown' }),
  );
  await f.coordinator.tick();
  assert.equal(f.records()[0].status, 'failed');
  assert.equal(f.count(), 1);
});

test('an interrupted dispatch is never automatically replayed after restart', async () => {
  const f = fixture();
  f.deps.start = async () => {
    throw new Error('Lost connection after dispatch');
  };
  const first = await f.coordinator.trigger({ kind: 'meeting', idempotencyKey: 'restart' });
  assert.equal(first.status, 'failed');
  const restarted = new DemoCoordinator(f.deps);
  await restarted.tick();
  assert.equal((await restarted.trigger({ kind: 'meeting', idempotencyKey: 'restart' })).id, first.id);
  await assert.rejects(restarted.retry(first.id), /dispatch was interrupted/);
});

test('presets use the bundled sales data and fixed-dollar checkout reproduction', async () => {
  const f = fixture();
  const email = await f.coordinator.trigger({ kind: 'email' });
  assert.match(email.attachments[0].content, /^month,product,units,unit_price_usd,unit_cost_usd\n/);
  const meeting = await f.coordinator.trigger({ kind: 'meeting' });
  assert.deepEqual(
    meeting.attachments.map((file) => file.name),
    ['agenda.md', 'sales.csv', 'campaigns.csv'],
  );
  assert.match(meeting.content, /America\/New_York/);
  const slack = await f.coordinator.trigger({ kind: 'slack' });
  assert.deepEqual(
    slack.attachments.map((file) => file.name),
    ['reproduction.json'],
  );
  const reproduction = JSON.parse(slack.attachments[0].content);
  assert.deepEqual(reproduction.cases[0], {
    arguments: [100, 0.08, 10],
    actualApprox: 104.4,
    expected: 97.2,
  });
});
