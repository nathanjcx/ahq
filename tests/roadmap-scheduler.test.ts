import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { advanceRoadmap } from '../desktop/roadmap';
import { initialState } from '../src/lib/store';
import { applyDecision, applySession } from '../src/lib/workflow';
import { recordAssignedTask } from '../src/lib/assignedTasks';
import type { AppState, Approval, CloudSession, Commitment, Employee } from '../shared/types';

const now = '2026-09-10T15:00:00.000Z';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
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
const contentHash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
function handoff(assignment: string) {
  return JSON.parse(assignment.slice(assignment.indexOf('{\n')));
}
function approvedReview(commitmentId: string, content: string, fields: Partial<Approval> = {}): Approval {
  return {
    id: `review-${commitmentId}`,
    employeeId: 'engineer',
    title: 'Reviewed work',
    summary: '',
    content,
    createdAt: now,
    status: 'approved',
    commitmentId,
    kind: 'document',
    recipient: 'You',
    sources: [],
    version: 1,
    sessionId: `session-${commitmentId}`,
    ...fields,
  };
}
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
  assert.match(h.starts[0].assignment, /"firstAction": "Begin this step"/);
  assert.match(h.starts[0].assignment, /"definitionOfDone": "A finished deliverable for review"/);
  assert.match(h.starts[0].assignment, /"due": "2026-09-10T15:00:00.000Z"/);
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
  const dependency = handoff(h.starts[1].assignment).approvedDependencies[0];
  assert.deepEqual(dependency.assignedOwner, {
    id: 'engineer',
    name: 'engineer',
    jobTitle: 'Software Engineer',
  });
  assert.equal(dependency.commitmentId, 'Research');
  assert.equal(dependency.sessionId, 'chatgpt-1');
  assert.deepEqual(dependency.review, {
    id: state.approvals[0].id,
    version: 1,
    status: 'approved',
    employeeId: 'engineer',
  });
  assert.equal(dependency.reviewedContentSha256, contentHash(output.content));
  assert.equal(dependency.sharedContentSha256, contentHash(output.content));
  assert.equal(dependency.contentTruncated, false);
  assert.equal(dependency.originalFilesShared, false);
  assert.equal('approvedAt' in dependency.review, false);
  assert.equal(state.employees[0].sessionId, 'chatgpt-2');
  state = await advanceRoadmap(state, h.deps);
  assert.equal(state.employees[0].sessionId, 'chatgpt-2');
  assert.equal(state.employees[0].status, 'working');
});

test('handoffs use the approved review of the actual assigned session, not another session’s higher version', async () => {
  const h = harness();
  const state = workspace([
    { ...milestone('Research'), status: 'done', progress: 100 },
    milestone('Build', ['Research']),
  ]);
  state.roadmap!.assignments.push({
    commitmentId: 'Research',
    employeeId: 'engineer',
    sessionId: 'actual-session',
    status: 'assigned',
  });
  state.approvals = [
    approvedReview('Research', 'Actual approved work', { id: 'actual-review', sessionId: 'actual-session' }),
    approvedReview('Research', 'Unrelated later conversation', {
      id: 'unrelated-review',
      version: 99,
      sessionId: 'another-session',
    }),
  ];
  await advanceRoadmap(state, h.deps);
  const dependency = handoff(h.starts[0].assignment).approvedDependencies[0];
  assert.equal(dependency.review.id, 'actual-review');
  assert.equal(dependency.sessionId, 'actual-session');
  assert.equal(dependency.approvedWork, 'Actual approved work');
  assert.doesNotMatch(h.starts[0].assignment, /Unrelated later conversation/);
});

test('goal handoffs include relevant roadmap tasks and roster without unrelated office work', async () => {
  const h = harness();
  const state = workspace(
    [
      { ...milestone('Research', [], 'researcher'), status: 'done', progress: 100 },
      milestone('Build', ['Research']),
    ],
    [employee(), employee('researcher', 'Researcher'), employee('private-owner', 'Unrelated private role')],
  );
  state.commitments.push({ ...milestone('Private archive task', [], 'private-owner'), status: 'done' });
  state.approvals.push(approvedReview('Research', 'Approved research', { employeeId: 'researcher' }));
  await advanceRoadmap(state, h.deps);
  const context = handoff(h.starts[0].assignment).goalContext;
  assert.equal(context.roadmapId, state.roadmap!.id);
  assert.deepEqual(
    context.tasks.map((item: { commitmentId: string }) => item.commitmentId),
    ['Build', 'Research'],
  );
  assert.deepEqual(
    context.roster.map((item: { id: string }) => item.id),
    ['engineer', 'researcher'],
  );
  assert.equal(context.omittedTasks, 0);
  assert.equal(context.omittedEmployees, 0);
  assert.doesNotMatch(h.starts[0].assignment, /Private archive task|Unrelated private role/);
  assert.match(h.starts[0].assignment, /not upstream original files/);
});

test('unreviewed completion notes and missing employee profiles never become fabricated provenance', async () => {
  const h = harness();
  const state = workspace([
    { ...milestone('Earlier task', [], 'former-employee'), status: 'done', nextStep: 'Marked done manually' },
    milestone('Build', ['Earlier task']),
  ]);
  state.approvals.push(approvedReview('Earlier task', 'Not approved', { status: 'pending' }));
  // This pending review belongs to a departed employee, not the available worker.
  state.approvals[0].employeeId = 'former-employee';
  await advanceRoadmap(state, h.deps);
  const dependency = handoff(h.starts[0].assignment).approvedDependencies[0];
  assert.deepEqual(dependency.assignedOwner, { id: 'former-employee', name: null, jobTitle: null });
  assert.equal(dependency.review, null);
  assert.equal(dependency.sessionId, null);
  assert.equal(dependency.approvedWork, null);
  assert.equal(dependency.completionNote, 'Marked done manually');
  assert.equal(dependency.contentSource, 'unreviewed-completion-note');
  assert.equal(dependency.reviewedContentSha256, null);
});

test('truncated handoffs hash the full reviewed text separately from the shared excerpt', async () => {
  const h = harness();
  const content = 'Reviewed evidence. '.repeat(600);
  const state = workspace([
    { ...milestone('Research'), status: 'done', progress: 100 },
    milestone('Build', ['Research']),
  ]);
  state.approvals.push(approvedReview('Research', content));
  await advanceRoadmap(state, h.deps);
  const dependency = handoff(h.starts[0].assignment).approvedDependencies[0];
  assert.equal(dependency.approvedWork.length, 6000);
  assert.equal(dependency.originalContentChars, content.length);
  assert.equal(dependency.contentTruncated, true);
  assert.equal(dependency.reviewedContentSha256, contentHash(content));
  assert.equal(dependency.sharedContentSha256, contentHash(dependency.approvedWork));
  assert.notEqual(dependency.reviewedContentSha256, dependency.sharedContentSha256);
});

test('large dependency provenance remains bounded with explicit omissions and valid included hashes', async () => {
  const h = harness();
  const dependencies = Array.from({ length: 100 }, (_, index) => ({
    ...milestone(`dependency-${index}-${'x'.repeat(80)}`),
    title: '\u0001'.repeat(120),
    status: 'done' as const,
    progress: 100,
  }));
  const state = workspace(
    [
      ...dependencies,
      milestone(
        'Build',
        dependencies.map((item) => item.id),
      ),
    ],
    [{ ...employee(), name: '\u0001'.repeat(40), jobTitle: '\u0001'.repeat(80) }],
  );
  const content = 'Long reviewed output. '.repeat(400);
  state.approvals = dependencies.map((item, index) =>
    approvedReview(item.id, content, {
      sessionId: `session-${index}-${'s'.repeat(180)}`,
    }),
  );
  await advanceRoadmap(state, h.deps);
  const assignment = h.starts[0].assignment;
  const payload = handoff(assignment);
  assert.ok(assignment.length < 62000);
  assert.ok(payload.omittedDependencies > 0);
  assert.equal(payload.omittedDependencies + payload.approvedDependencies.length, 100);
  assert.equal(payload.goalContext.omittedTasks + payload.goalContext.tasks.length, 101);
  for (const dependency of payload.approvedDependencies) {
    assert.equal(dependency.review.status, 'approved');
    assert.equal(dependency.reviewedContentSha256, contentHash(content));
    assert.equal(dependency.sharedContentSha256, contentHash(dependency.approvedWork));
    assert.equal(dependency.contentTruncated, true);
  }
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
  state.commitments[0].source = 'Manager assignment';
  await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 0);
});

test('unclaimed generated work moves from a busy suggested owner to a suitable idle teammate', async () => {
  for (const source of ['AI goal roadmap', 'AI roadmap']) {
    const h = harness();
    const state = workspace(
      [milestone('Build app')],
      [
        { ...employee(), status: 'working' },
        employee('writer', 'Content Writer'),
        employee('other', 'Software Engineer'),
      ],
    );
    state.commitments[0].source = source;
    const next = await advanceRoadmap(state, h.deps);
    assert.equal(h.starts.length, 1);
    assert.equal(h.starts[0].employee.id, 'other');
    assert.equal(next.commitments[0].ownerId, 'other');
    assert.equal(next.roadmap!.assignments[0].employeeId, 'other');
    assert.equal(next.employees[0].status, 'working');
  }
});

test('generated specialist work waits when available teammates are a worse fit', async () => {
  const h = harness();
  const state = await advanceRoadmap(
    workspace(
      [milestone('Build app')],
      [{ ...employee(), status: 'working' }, employee('writer', 'Content Writer')],
    ),
    h.deps,
  );
  assert.equal(h.starts.length, 0);
  assert.equal(state.commitments[0].ownerId, 'engineer');
});

test('stale working and review labels recover only after a confirmed completed reviewed session', async () => {
  for (const status of ['working', 'review'] as const) {
    const h = harness();
    h.sessions.set('previous', { ...session('previous', 'completed'), output, reviewed: true });
    const next = await advanceRoadmap(
      workspace(undefined, [{ ...employee(), status, sessionId: 'previous' }]),
      h.deps,
    );
    assert.equal(h.starts.length, 1);
    assert.equal(next.employees[0].sessionId, 'chatgpt-1');
    assert.equal(next.employees[0].status, 'working');
  }
  for (const previous of [
    session('previous', 'running'),
    session('previous', 'failed'),
    { ...session('previous', 'completed'), output },
  ]) {
    const h = harness();
    h.sessions.set('previous', previous);
    await advanceRoadmap(
      workspace(undefined, [{ ...employee(), status: 'working', sessionId: 'previous' }]),
      h.deps,
    );
    assert.equal(h.starts.length, 0);
  }
});

test('a newer manual session is preserved while old roadmap output is reconciled', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace(), h.deps);
  h.sessions.set('chatgpt-1', { ...session('chatgpt-1', 'waiting_for_approval'), output });
  const newer = { ...state.employees[0], sessionId: 'manual-newer', activity: 'A newer manual assignment' };
  state.employees[0] = newer;
  h.sessions.set('manual-newer', session('manual-newer'));
  state.commitments.push(milestone('Another build'));
  state.roadmap!.milestoneIds.push('Another build');
  state = await advanceRoadmap(state, h.deps);
  assert.deepEqual(state.employees[0], newer);
  assert.equal(state.commitments[0].status, 'review');
  assert.equal(state.approvals[0].sessionId, 'chatgpt-1');
  assert.equal(h.starts.length, 1);
});

test('an unfinished claim blocks reassignment even if a newer completed session makes the employee look idle', async () => {
  const h = harness();
  let state = await advanceRoadmap(workspace(), h.deps);
  h.sessions.set('newer', { ...session('newer', 'completed'), output, reviewed: true });
  state.employees[0] = { ...state.employees[0], status: 'ready', sessionId: 'newer' };
  state.commitments.push(milestone('Another build'));
  state.roadmap!.milestoneIds.push('Another build');
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 1);
  assert.equal(state.commitments[1].status, 'planned');
  assert.equal(state.employees[0].sessionId, 'newer');
});

test('a slow start does not block other employees and each confirmation saves without waiting for it', async () => {
  const h = harness();
  const slow = deferred<CloudSession>();
  const fastSaved = deferred<void>();
  let prepares = 0;
  const next = advanceRoadmap(
    workspace(
      [milestone('Build app'), milestone('Write guide', [], 'writer')],
      [employee(), employee('writer', 'Writer')],
    ),
    {
      ...h.deps,
      async prepare() {
        prepares++;
      },
      async start(person, assignment) {
        const started = await h.deps.start(person, assignment);
        return person.id === 'engineer' ? slow.promise : started;
      },
      async save(state) {
        await h.deps.save(state);
        if (
          state.roadmap!.assignments.some(
            (claim) => claim.employeeId === 'writer' && claim.status === 'assigned',
          )
        )
          fastSaved.resolve();
      },
    },
  );
  await fastSaved.promise;
  assert.equal(prepares, 1);
  assert.equal(h.starts.length, 2);
  assert.equal(h.saved[0].roadmap!.assignments.filter((claim) => claim.status === 'starting').length, 2);
  assert.equal(
    h.saved.at(-1)!.roadmap!.assignments.find((claim) => claim.employeeId === 'engineer')!.status,
    'starting',
  );
  slow.resolve(session('chatgpt-1'));
  const result = await next;
  assert.equal(result.roadmap!.assignments.filter((claim) => claim.status === 'assigned').length, 2);
});

test('a failed parallel start preserves every other confirmed assignment and never retries uncertain work', async () => {
  const h = harness();
  let attempts = 0;
  const deps = {
    ...h.deps,
    async start(person: Employee, assignment: string) {
      attempts++;
      if (person.id === 'engineer') throw new Error('Connection lost after dispatch');
      return h.deps.start(person, assignment);
    },
  };
  let state = await advanceRoadmap(
    workspace(
      [milestone('Build app'), milestone('Write guide', [], 'writer')],
      [employee(), employee('writer', 'Writer')],
    ),
    deps,
  );
  assert.equal(attempts, 2);
  assert.equal(state.roadmap!.status, 'paused');
  assert.equal(
    state.roadmap!.assignments.find((claim) => claim.employeeId === 'engineer')!.status,
    'stopped',
  );
  assert.equal(state.roadmap!.assignments.find((claim) => claim.employeeId === 'writer')!.status, 'assigned');
  state = await advanceRoadmap(state, deps);
  assert.equal(attempts, 2);
  assert.equal(state.employees.find((person) => person.id === 'writer')!.status, 'working');
});

test('parallel confirmations never overlap saves and a failed save drains outstanding dispatches', async () => {
  const h = harness();
  const slow = deferred<CloudSession>();
  const attemptedSave = deferred<void>();
  let settled = false;
  let saving = false;
  const next = advanceRoadmap(
    workspace(
      [milestone('Build app'), milestone('Write guide', [], 'writer')],
      [employee(), employee('writer', 'Writer')],
    ),
    {
      ...h.deps,
      async start(person, assignment) {
        const started = await h.deps.start(person, assignment);
        return person.id === 'writer' ? slow.promise : started;
      },
      async save(state) {
        assert.equal(saving, false);
        saving = true;
        try {
          if (h.saved.length) {
            attemptedSave.resolve();
            throw new Error('Storage unavailable');
          }
          await h.deps.save(state);
        } finally {
          saving = false;
        }
      },
    },
  );
  next.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await attemptedSave.promise;
  await Promise.resolve();
  assert.equal(settled, false, 'Do not release the workspace lock while another dispatch is pending.');
  slow.resolve(session('chatgpt-2'));
  await assert.rejects(next, /Storage unavailable/);
  assert.equal(h.saved[0].roadmap!.assignments.length, 2);
  const recovered = await advanceRoadmap(h.saved[0], h.deps);
  assert.equal(recovered.roadmap!.status, 'paused');
  assert.equal(h.starts.length, 2);
});

test('dispatch batches are bounded and do not allocate two active steps to one employee', async () => {
  const h = harness();
  const employees = Array.from({ length: 6 }, (_, index) => employee(`dev-${index}`));
  const commitments = employees.flatMap((person, index) => [
    milestone(`Build app ${index}`, [], person.id),
    milestone(`Build another app ${index}`, [], person.id),
  ]);
  let state = await advanceRoadmap(workspace(commitments, employees), h.deps);
  assert.equal(h.starts.length, 4);
  assert.equal(new Set(h.starts.map((start) => start.employee.id)).size, 4);
  state = await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 6);
  assert.equal(new Set(h.starts.map((start) => start.employee.id)).size, 6);
  await advanceRoadmap(state, h.deps);
  assert.equal(h.starts.length, 6);
});

test('session readiness reads run concurrently within a bound and never preflight before verification', async () => {
  const h = harness();
  const firstFour = deferred<void>();
  const release = deferred<void>();
  let reading = 0;
  let peak = 0;
  let checked = 0;
  let prepares = 0;
  const employees = Array.from({ length: 6 }, (_, index) => ({
    ...employee(`dev-${index}`),
    status: 'working' as const,
    sessionId: `previous-${index}`,
  }));
  const next = advanceRoadmap(
    workspace(
      employees.map((person, index) => milestone(`Build app ${index}`, [], person.id)),
      employees,
    ),
    {
      ...h.deps,
      async getSession(id) {
        reading++;
        peak = Math.max(peak, reading);
        if (reading === 4) firstFour.resolve();
        await release.promise;
        reading--;
        checked++;
        return { ...session(id, 'completed'), output, reviewed: true };
      },
      async prepare() {
        assert.equal(checked, 6);
        prepares++;
      },
    },
  );
  await firstFour.promise;
  assert.equal(h.starts.length, 0);
  assert.equal(prepares, 0);
  release.resolve();
  await next;
  assert.equal(peak, 4);
  assert.equal(checked, 6);
  assert.equal(prepares, 1);
  assert.equal(h.starts.length, 4);
});

test('the same session referenced by an employee and a claim is read once per tick', async () => {
  const h = harness();
  const state = await advanceRoadmap(workspace(), h.deps);
  let reads = 0;
  await advanceRoadmap(state, {
    ...h.deps,
    async getSession(id) {
      reads++;
      return h.deps.getSession(id);
    },
  });
  assert.equal(reads, 1);
  assert.equal(h.starts.length, 1);
});

test('a failed batch claim save launches no employee and a restart sends no unconfirmed batch twice', async () => {
  const h = harness();
  const state = workspace(
    [milestone('Build app'), milestone('Write guide', [], 'writer')],
    [employee(), employee('writer', 'Writer')],
  );
  await assert.rejects(
    advanceRoadmap(state, {
      ...h.deps,
      async save() {
        throw new Error('Disk full');
      },
    }),
    /Disk full/,
  );
  assert.equal(h.starts.length, 0);
  state.roadmap!.assignments = [
    { commitmentId: 'Build app', employeeId: 'engineer', status: 'starting' },
    { commitmentId: 'Write guide', employeeId: 'writer', status: 'starting' },
  ];
  const recovered = await advanceRoadmap(state, h.deps);
  assert.equal(recovered.roadmap!.status, 'paused');
  assert.equal(h.starts.length, 0);
});

test('a provider returning another employee’s session never transfers ownership', async () => {
  const h = harness();
  const state = await advanceRoadmap(
    workspace(
      [milestone('Build app'), milestone('Write guide', [], 'writer')],
      [employee(), employee('writer', 'Writer')],
    ),
    {
      ...h.deps,
      async start() {
        return session('same-session');
      },
    },
  );
  assert.equal(state.roadmap!.status, 'paused');
  assert.equal(state.roadmap!.assignments.filter((claim) => claim.status === 'assigned').length, 1);
  assert.equal(state.roadmap!.assignments.filter((claim) => claim.status === 'stopped').length, 1);
  assert.equal(state.employees.filter((person) => person.sessionId === 'same-session').length, 1);
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
