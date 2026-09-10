import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GoalCoordinator } from '../desktop/goals';
import { advanceRoadmap } from '../desktop/roadmap';
import { roadmapTask, validateLocalArtifacts } from '../desktop/demo-roadmap';
import { mergeWorkspace } from '../shared/workspaceMerge';
import { initialState } from '../src/lib/store';
import type { AppState, CloudSession, Commitment } from '../shared/types';
import type { LocalTaskInput } from '../shared/demo';

function milestone(
  id: string,
  dependencies: string[] = [],
  taskKind: Commitment['taskKind'] = 'report',
): Commitment {
  return {
    id,
    title: id,
    description: `Produce ${id} with evidence`,
    ownerId: '',
    recipient: 'You',
    deadline: '',
    firm: false,
    status: 'planned',
    progress: 0,
    nextStep: 'Read the supplied data',
    dependencies,
    source: 'AI goal roadmap',
    definitionOfDone: 'A complete, validated local deliverable',
    taskKind,
  };
}
async function completedSession(root: string, id: string, content: string): Promise<CloudSession> {
  const workspace = path.join(root, id);
  await mkdir(workspace);
  const filePath = path.join(workspace, 'report.md');
  await writeFile(filePath, content);
  return {
    id,
    workspace,
    status: 'completed',
    reviewed: true,
    location: 'desk',
    activity: 'Finished',
    events: [],
    output: { title: id, content, version: 1, recipient: 'You', sources: [] },
    artifacts: [{ id: `artifact-${id}`, title: id, kind: 'report', filePath, content, simulated: false }],
  };
}

test('automatic goal runs independent analyses then hands complete verified artifacts to synthesis without a prior review poll', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ahq-roadmap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let state = initialState();
  const sessions = new Map<string, CloudSession>();
  const starts: LocalTaskInput[] = [];
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const deps = {
    async save(next: AppState) {
      state = structuredClone(next);
    },
    async getSession(id: string) {
      const session = sessions.get(id);
      assert(session);
      return session;
    },
    async start(employee: AppState['employees'][number], _assignment: string, current: AppState) {
      const task = await roadmapTask(current, employee.id, deps.getSession);
      starts.push(task);
      const session: CloudSession = {
        id: `chatgpt-${task.title}`,
        status: 'running',
        activity: 'Working',
        location: 'desk',
        events: [],
      };
      sessions.set(session.id, session);
      return session;
    },
  };
  const coordinator = new GoalCoordinator({
    load: async () => state,
    save: deps.save,
    queue: async (action) => action(),
    generate: async () => [
      milestone('Sales'),
      milestone('Support'),
      milestone('Synthesis', ['Sales', 'Support'], 'meeting'),
    ],
    advance: async (next) => {
      const result = await advanceRoadmap(next, deps);
      started();
      return result;
    },
  });
  t.after(() => coordinator.close());
  await coordinator.create('Analyze sales and support, then synthesize', { automatic: true });
  await ready;
  assert.equal(state.employees.length, 3);
  assert(state.employees.every((employee) => employee.temporary));
  assert.equal(new Set(state.commitments.map((task) => task.ownerId)).size, 3);
  assert.deepEqual(starts.map((task) => task.title).sort(), ['Sales', 'Support']);
  const longEvidence = `Sales evidence ${'x'.repeat(25_000)}`;
  sessions.set('chatgpt-Sales', await completedSession(root, 'chatgpt-Sales', longEvidence));
  state = await advanceRoadmap(state, deps);
  assert.equal(state.commitments.find((task) => task.id === 'Sales')?.status, 'done');
  assert.equal(starts.length, 2, 'Synthesis must still wait for Support');
  sessions.set('chatgpt-Support', await completedSession(root, 'chatgpt-Support', 'Support source evidence'));
  state = await advanceRoadmap(state, deps);
  // The independent analyses start concurrently; only Synthesis must start after both.
  assert.deepEqual(
    starts
      .slice(0, 2)
      .map((task) => task.title)
      .sort(),
    ['Sales', 'Support'],
  );
  assert.equal(starts[2].title, 'Synthesis');
  assert(
    starts[2].files.some((file) => file.content.includes(longEvidence)),
    'Full predecessor evidence must not be truncated',
  );
  assert(starts[2].files.some((file) => file.content.includes('Support source evidence')));
  state = await advanceRoadmap(state, deps);
  assert.equal(starts.length, 3, 'Repeated scheduler polls must not repeat completed or active work');
  sessions.set('chatgpt-Synthesis', await completedSession(root, 'chatgpt-Synthesis', 'Executive synthesis'));
  state = await advanceRoadmap(state, deps);
  assert.equal(state.roadmap?.status, 'complete');
});

test('artifact handoff refuses missing files, escaped paths and unresolved review choices', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ahq-roadmap-validation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = await completedSession(root, 'valid', 'Verified evidence');
  assert.equal(await validateLocalArtifacts(session), true);
  assert.equal(
    await validateLocalArtifacts({ ...session, output: { ...session.output!, choices: ['A', 'B'] } }),
    false,
  );
  await writeFile(path.join(root, 'outside.md'), 'Outside workspace');
  const link = path.join(session.workspace!, 'escape.md');
  await symlink(path.join(root, 'outside.md'), link);
  assert.equal(
    await validateLocalArtifacts({ ...session, artifacts: [{ ...session.artifacts![0], filePath: link }] }),
    false,
  );
  await rm(session.artifacts![0].filePath);
  assert.equal(await validateLocalArtifacts(session), false);
  const dependency = { ...milestone('Research'), status: 'done' as const, sessionId: session.id };
  const task = milestone('Synthesis', ['Research'], 'meeting');
  const state: AppState = {
    ...initialState(),
    commitments: [dependency, task],
    roadmap: {
      id: 'plan',
      goal: 'Analyze',
      automatic: true,
      status: 'active',
      createdAt: new Date().toISOString(),
      message: '',
      milestoneIds: ['Research', 'Synthesis'],
      assignments: [{ commitmentId: 'Synthesis', employeeId: 'worker', status: 'starting' }],
    },
  };
  await assert.rejects(
    roadmapTask(state, 'worker', async () => session),
    /verified completed artifacts/,
  );
});

test('QA handoff identifies the exact completed bug session and workspace', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ahq-roadmap-qa-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const session = await completedSession(root, 'chatgpt-code', 'Patch evidence');
  const bug = { ...milestone('Fix', [], 'bug'), status: 'done' as const, sessionId: session.id };
  const qa = milestone('Verify', ['Fix'], 'qa');
  const state: AppState = {
    ...initialState(),
    commitments: [bug, qa],
    roadmap: {
      id: 'plan',
      goal: 'Fix checkout',
      automatic: true,
      status: 'active',
      createdAt: new Date().toISOString(),
      message: '',
      milestoneIds: ['Fix', 'Verify'],
      assignments: [{ commitmentId: 'Verify', employeeId: 'qa-worker', status: 'starting' }],
    },
  };
  const task = await roadmapTask(state, 'qa-worker', async () => session);
  assert.equal(task.parentSessionId, session.id);
  assert.equal(task.parentWorkspace, session.workspace);
  assert.equal(task.kind, 'qa');
});

test('stale renderer snapshots retain newly spawned temporary employees and their backend session state', () => {
  const stale = initialState();
  const worker = {
    id: 'demo-worker',
    name: 'Analyst',
    jobTitle: 'Analyst',
    personality: 'Careful',
    skills: 'Astra session',
    color: '#557766',
    avatar: 1,
    temporary: true,
    status: 'working' as const,
    activity: 'Reading sales.csv',
    location: 'desk' as const,
    sessionId: 'chatgpt-current',
  };
  const current = { ...stale, employees: [worker] };
  const merged = mergeWorkspace(current, stale);
  assert.deepEqual(merged.employees, [worker]);
  const edited = {
    ...stale,
    employees: [
      {
        ...worker,
        temporary: false,
        status: 'ready' as const,
        sessionId: 'chatgpt-stale',
        name: 'Edited name',
      },
    ],
  };
  const preserved = mergeWorkspace(current, edited).employees[0];
  assert.equal(preserved.name, 'Edited name');
  assert.equal(preserved.temporary, true);
  assert.equal(preserved.status, 'working');
  assert.equal(preserved.sessionId, 'chatgpt-current');
});

test('editing a future automatic milestone keeps its backend execution kind', () => {
  const task = milestone('Synthesis', [], 'meeting');
  const current: AppState = {
    ...initialState(),
    commitments: [task],
    roadmap: {
      id: 'plan',
      goal: 'Analyze',
      automatic: true,
      status: 'active',
      createdAt: new Date().toISOString(),
      message: '',
      milestoneIds: [task.id],
      assignments: [],
    },
  };
  // CommitmentForm rebuilds ordinary fields and does not send the internal execution kind.
  const edited = {
    ...current,
    commitments: [{ ...task, title: 'A clearer synthesis title', taskKind: undefined }],
  };
  const merged = mergeWorkspace(current, edited).commitments[0];
  assert.equal(merged.title, 'A clearer synthesis title');
  assert.equal(merged.taskKind, 'meeting');
});
