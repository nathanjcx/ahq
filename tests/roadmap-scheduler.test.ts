import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceRoadmap } from '../desktop/roadmap';
import { initialState } from '../src/lib/store';
import { applyDecision, applySession } from '../src/lib/workflow';
import { recordAssignedTask } from '../src/lib/assignedTasks';
import type { AppState, CloudSession, Commitment, Employee } from '../shared/types';

const now = '2026-09-10T15:00:00.000Z';
const employee = (id = 'engineer', jobTitle = 'Software Engineer'): Employee => ({
  id,
  name: id,
  jobTitle,
  personality: 'Clear and thoughtful.',
  skills: 'Astra session',
  color: '#557766',
  avatar: 1,
  status: 'ready',
  activity: 'Ready for an assignment',
  location: 'desk',
});
const milestone = (id: string, dependencies: string[] = [], ownerId = 'engineer'): Commitment => ({
  id,
  title: id,
  description: `Complete ${id}`,
  ownerId,
  recipient: 'You',
  deadline: now,
  firm: false,
  status: 'planned',
  progress: 0,
  nextStep: 'Begin this step',
  dependencies,
  source: 'AI roadmap',
  definitionOfDone: 'A finished deliverable for review',
});
function workspace(commitments = [milestone('Build app')], employees = [employee()]): AppState {
  return {
    ...initialState(),
    goal: 'Build a useful application',
    employees,
    commitments,
    roadmap: {
      id: 'roadmap-1',
      goal: 'Build a useful application',
      status: 'active',
      message: '',
      createdAt: now,
      milestoneIds: commitments.map((item) => item.id),
      assignments: [],
    },
  };
}
function session(id: string, status: CloudSession['status'] = 'running'): CloudSession {
  return { id, status, activity: 'Working on your assignment', location: 'desk', events: [] };
}
const output = {
  title: 'Finished work',
  content: 'Approved research to build on.',
  sources: [],
  recipient: 'You',
  version: 1,
};
function harness() {
  const saved: AppState[] = [];
  const starts: { employee: Employee; assignment: string }[] = [];
  const sessions = new Map<string, CloudSession>();
  const deps = {
    async save(state: AppState) {
      saved.push(structuredClone(state));
    },
    async getSession(id: string) {
      assert(sessions.has(id), `Missing fake session ${id}`);
      return sessions.get(id)!;
    },
    async start(person: Employee, assignment: string) {
      const pending = saved
        .at(-1)
        ?.roadmap?.assignments.find((item) => item.employeeId === person.id && item.status === 'starting');
      assert(pending, 'A durable starting claim must exist before a session starts.');
      starts.push({ employee: person, assignment });
      const item = session(`chatgpt-${starts.length}`);
      sessions.set(item.id, item);
      return item;
    },
  };
  return { deps, starts, sessions, saved };
}

test('claims are durable before model execution and repeated ticks never duplicate an assignment', async () => {
  const h = harness();
  const first = await advanceRoadmap(workspace(), h.deps);
  assert.equal(h.starts.length, 1);
  assert.equal(first.roadmap?.assignments[0].sessionId, 'chatgpt-1');
  assert.equal(first.commitments[0].status, 'in-progress');
  assert.equal(first.employees[0].status, 'working');
  assert.equal(h.saved[0].roadmap?.assignments[0].status, 'starting');
  const restarted = await advanceRoadmap(structuredClone(first), h.deps);
  assert.equal(h.starts.length, 1);
  assert.deepEqual(restarted.roadmap?.assignments, first.roadmap?.assignments);
});

test('manual assignments are never dispatched twice and their approval unlocks dependent work', async () => {
  const h = harness();
  const manualSession = session('chatgpt-manual');
  let state = recordAssignedTask(
    workspace([]),
    'engineer',
    'Investigate the launch requirements',
    manualSession,
  );
  const manualId = state.commitments[0].id;
  state.commitments.push(milestone('Build', [manualId]));
  state.roadmap!.milestoneIds.push('Build');
  state = await advanceRoadmap(state, h.deps);
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 0);
  assert.equal(state.roadmap!.assignments.length, 0);
  assert.equal(state.commitments[0].sessionId, manualSession.id);
  state = applySession(state, 'engineer', { ...manualSession, status: 'waiting_for_approval', output });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 0);
  state = applyDecision(state, state.approvals[0].id, 1, 'approved');
  h.sessions.set(manualSession.id, { ...manualSession, status: 'completed', output, reviewed: true });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 1);
  assert.match(h.starts[0].assignment, /Approved research to build on/);
  assert.equal(state.commitments[0].status, 'done');
  assert.equal(state.commitments[1].status, 'in-progress');
  assert.deepEqual(
    state.roadmap!.assignments.map((a) => a.commitmentId),
    ['Build'],
  );
});

test('dependent work waits for approval, then receives the approved deliverable', async () => {
  const h = harness();
  let state = await advanceRoadmap(
    workspace([milestone('Research'), milestone('Build', ['Research'])]),
    h.deps,
  );
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.approvals[0].commitmentId, 'Research');
  assert.equal(h.starts.length, 1);
  state = applyDecision(state, state.approvals[0].id, 1, 'approved');
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'completed'), output, reviewed: true });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 2);
  assert.equal(state.commitments[0].status, 'done');
  assert.equal(state.commitments[1].status, 'in-progress');
  assert.match(h.starts[1].assignment, /Approved research to build on/);
  assert.equal(state.employees[0].sessionId, 'chatgpt-2');
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.employees[0].sessionId, 'chatgpt-2');
  assert.equal(state.employees[0].status, 'working');
});

test('revisions remain on the original assignment and never unlock dependent work early', async () => {
  const h = harness();
  let state = await advanceRoadmap(
    workspace([milestone('Research'), milestone('Build', ['Research'])]),
    h.deps,
  );
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  state = await advanceRoadmap(state, h.deps);
  state = applyDecision(state, state.approvals[0].id, 1, 'changes-requested', 'Please verify the evidence.');
  h.sessions.set('chatgpt-1', session('chatgpt-1'));
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.commitments[0].status, 'in-progress');
  assert.equal(state.commitments[1].status, 'planned');
  assert.equal(h.starts.length, 1);
  h.sessions.set('chatgpt-1', {
    ...session('chatgpt-1', 'waiting_for_approval'),
    output: { ...output, version: 2 },
  });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.approvals.at(-1)?.commitmentId, 'Research');
  assert.equal(state.approvals.at(-1)?.version, 2);
  assert.equal(h.starts.length, 1);
});

test('one employee waiting for review does not block unrelated work for another employee', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace([milestone('Research')]), h.deps);
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  state.employees.push(employee('writer', 'Writer'));
  state.commitments.push(milestone('Write guide', [], 'writer'));
  state.roadmap!.milestoneIds.push('Write guide');
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.commitments[1].status, 'in-progress');
  assert.equal(h.starts.length, 2);
});

test('busy, offline, and unresolved manual sessions remain untouched', async () => {
  const cases = [
    { ...employee(), status: 'working' as const },
    { ...employee(), status: 'review' as const },
    { ...employee(), status: 'offline' as const },
    { ...employee(), sessionId: 'manual' },
  ];
  for (const person of cases) {
    const h = harness();
    h.sessions.set('manual', session('manual'));
    const state = await advanceRoadmap(workspace(undefined, [person]), h.deps);
    assert.equal(h.starts.length, 0);
    assert.deepEqual(state.employees, [person]);
  }
  const h = harness();
  h.sessions.set('manual', { ...session('manual', 'completed'), output, reviewed: false });
  await advanceRoadmap(workspace(undefined, [{ ...employee(), sessionId: 'manual' }]), h.deps);
  assert.equal(h.starts.length, 0);
});

test('pending approval blocks an employee even when their displayed status is ready', async () => {
  const h = harness();
  const state = workspace();
  state.approvals.push({
    id: 'review',
    employeeId: 'engineer',
    title: 'Review this',
    summary: 'Waiting',
    content: '',
    createdAt: now,
    status: 'pending',
    kind: 'document',
    recipient: 'You',
    sources: [],
    version: 1,
  });
  await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 0);
});

test('an empty office keeps the roadmap ready and hiring starts the first suitable step', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace([milestone('Build code', [], '')], []), h.deps);
  assert.equal(state.roadmap?.status, 'active');
  assert.match(state.roadmap!.message, /Add an employee/);
  assert.equal(h.starts.length, 0);
  state.employees = [employee('writer', 'Content Writer'), employee('dev', 'Software Engineer')];
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0].employee.id, 'dev');
  assert.equal(state.commitments[0].ownerId, 'dev');
});

test('explicit roadmap ownership waits for that employee instead of rerouting their work', async () => {
  const h = harness();
  const state = workspace(undefined, [
    { ...employee(), status: 'working' },
    employee('other', 'Software Engineer'),
  ]);
  await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 0);
});

test('session failure and cancellation pause the roadmap without automatically retrying', async () => {
  for (const status of ['failed', 'completed'] as const) {
    const h = harness();
    let state = await advanceRoadmap(workspace(), h.deps);
    h.sessions.set('chatgpt-1', session('chatgpt-1', status));
    state = await advanceRoadmap(state, h.deps);
    assert.equal(state.roadmap?.status, 'paused');
    assert.equal(state.roadmap?.assignments[0].status, 'stopped');
    await advanceRoadmap(state, h.deps);
    assert.equal(h.starts.length, 1);
    state.roadmap!.status = 'active';
    state = await advanceRoadmap(state, h.deps);
    assert.equal(state.roadmap?.status, 'paused');
    assert.equal(h.starts.length, 1);
  }
});

test('a saved starting claim is never sent again after an interrupted process', async () => {
  const h = harness();
  const state = workspace();
  state.roadmap!.assignments.push({ commitmentId: 'Build app', employeeId: 'engineer', status: 'starting' });
  const result = await advanceRoadmap(state, h.deps);
  assert.equal(result.roadmap?.status, 'paused');
  assert.match(result.roadmap!.message, /could not be confirmed/);
  assert.equal(h.starts.length, 0);
});

test('failed claim persistence prevents execution; failed confirmation preserves the durable claim', async () => {
  const before = harness();
  await assert.rejects(
    advanceRoadmap(workspace(), {
      ...before.deps,
      async save() {
        throw new Error('Disk full');
      },
    }),
    /Disk full/,
  );
  assert.equal(before.starts.length, 0);
  const after = harness();
  await assert.rejects(
    advanceRoadmap(workspace(), {
      ...after.deps,
      async save(state) {
        if (after.saved.length) throw new Error('Disk disconnected');
        await after.deps.save(state);
      },
    }),
    /Disk disconnected/,
  );
  assert.equal(after.starts.length, 1);
  const recovered = await advanceRoadmap(after.saved[0], after.deps);
  assert.equal(recovered.roadmap?.status, 'paused');
  assert.equal(after.starts.length, 1);
});

test('start errors pause once and never repeatedly spend usage on retries', async () => {
  const h = harness();
  let attempts = 0;
  const deps = {
    ...h.deps,
    async start(): Promise<CloudSession> {
      attempts++;
      throw new Error('Unavailable');
    },
  };
  const state = await advanceRoadmap(workspace(), deps);
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(state.roadmap?.assignments[0].status, 'stopped');
  await advanceRoadmap(state, deps);
  assert.equal(attempts, 1);
});

test('a temporary session read error pauses but keeps the claim for a safe resume', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace(), h.deps);
  state = await advanceRoadmap(state, {
    ...h.deps,
    async getSession() {
      throw new Error('Disconnected');
    },
  });
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(state.roadmap?.assignments[0].status, 'assigned');
  state.roadmap!.status = 'active';
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.roadmap?.status, 'active');
  assert.equal(h.starts.length, 1);
});

test('the roadmap completes only once its last deliverable has been approved', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace(), h.deps);
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.roadmap?.status, 'active');
  state = applyDecision(state, state.approvals[0].id, 1, 'approved');
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'completed'), output, reviewed: true });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.roadmap?.status, 'complete');
  assert.equal(state.commitments[0].progress, 100);
});

test('corrupt missing dependencies pause instead of starting work without prerequisites', async () => {
  const h = harness();
  const state = await advanceRoadmap(workspace([milestone('Build', ['missing'])]), h.deps);
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(h.starts.length, 0);
});

test('paused roadmaps still attach reviews and never delegate newly unblocked work', async () => {
  const h = harness();
  let state = await advanceRoadmap(
    workspace([milestone('Research'), milestone('Build', ['Research'])]),
    h.deps,
  );
  state.roadmap!.status = 'paused';
  state.roadmap!.message = 'Paused by your manager.';
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(state.roadmap?.message, 'Paused by your manager.');
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.approvals[0].commitmentId, 'Research');
  state = applyDecision(state, state.approvals[0].id, 1, 'approved');
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'completed'), output, reviewed: true });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.commitments[0].status, 'done');
  assert.equal(state.commitments[1].status, 'planned');
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(state.roadmap?.message, 'Paused by your manager.');
  assert.equal(h.starts.length, 1);
});

test('paused roadmaps reconcile every employee and do not repeat pause events on polling errors', async () => {
  const h = harness();
  let state = await advanceRoadmap(
    workspace(
      [milestone('Research'), milestone('Writing', [], 'writer')],
      [employee(), employee('writer', 'Writer')],
    ),
    h.deps,
  );
  state.roadmap!.status = 'paused';
  state.roadmap!.message = 'Paused by your manager.';
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  h.sessions.set('chatgpt-2', { ...session('chatgpt-2', 'waiting_for_approval'), output });
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.approvals.length, 2);
  assert.equal(state.commitments.filter((item) => item.status === 'review').length, 2);
  const eventCount = state.events.length;
  const readFailure = {
    ...h.deps,
    async getSession(): Promise<CloudSession> {
      throw new Error('Offline');
    },
  };
  state = await advanceRoadmap(state, readFailure);
  state = await advanceRoadmap(state, readFailure);
  assert.equal(state.events.length, eventCount);
  assert.equal(state.roadmap?.message, 'Paused by your manager.');
});

test('account preflight failures create no claim and can safely resume after sign-in', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace(), {
    ...h.deps,
    async prepare() {
      throw new Error('Sign in to ChatGPT');
    },
  });
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(state.roadmap?.assignments.length, 0);
  assert.equal(h.starts.length, 0);
  state.roadmap!.status = 'active';
  state = await advanceRoadmap(state, { ...h.deps, async prepare() {} });
  assert.equal(state.roadmap?.status, 'active');
  assert.equal(h.starts.length, 1);
});

test('a sample office never reads sessions, reserves work, or starts real AI work', async () => {
  for (const status of ['active', 'paused'] as const) {
    const state = workspace();
    state.demo = true;
    state.roadmap!.status = status;
    let calls = 0;
    const result = await advanceRoadmap(state, {
      async save() {
        calls++;
      },
      async getSession() {
        calls++;
        throw new Error('Should not read a sample session');
      },
      async prepare() {
        calls++;
      },
      async start() {
        calls++;
        throw new Error('Should not start real sample work');
      },
    });
    assert.equal(result, state);
    assert.equal(calls, 0);
  }
});

test('a dependency loop pauses with an actionable message instead of waiting forever', async () => {
  const h = harness();
  const state = await advanceRoadmap(
    workspace([milestone('Research', ['Build']), milestone('Build', ['Research'])]),
    h.deps,
  );
  assert.equal(state.roadmap?.status, 'paused');
  assert.match(state.roadmap!.message, /loop/);
  assert.match(state.roadmap!.message, /Edit their dependencies/);
  assert.equal(h.starts.length, 0);
});

test('dependency validation handles a thousand steps without recursion and ignores unrelated archives', async () => {
  const chain = Array.from({ length: 1_000 }, (_, index) =>
    milestone(String(index), index ? [String(index - 1)] : []),
  );
  const valid = harness();
  let state = await advanceRoadmap(workspace(chain), valid.deps);
  assert.equal(state.roadmap?.status, 'active');
  assert.equal(valid.starts.length, 1);
  const loop = harness();
  const cyclic = structuredClone(chain);
  cyclic[0].dependencies = ['999'];
  state = await advanceRoadmap(workspace(cyclic), loop.deps);
  assert.equal(state.roadmap?.status, 'paused');
  assert.equal(loop.starts.length, 0);
  const archived = harness();
  const office = workspace();
  office.commitments.push(milestone('old-a', ['old-b']), milestone('old-b', ['old-a']));
  state = await advanceRoadmap(office, archived.deps);
  assert.equal(state.roadmap?.status, 'active');
  assert.equal(archived.starts.length, 1);
});
