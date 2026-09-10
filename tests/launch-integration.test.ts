import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatGPTEmployees } from '../desktop/chatgpt';
import { DemoCoordinator, type DemoRecord } from '../desktop/demo';
import { roadmapTask, validateLocalArtifacts } from '../desktop/demo-roadmap';
import { GoalCoordinator } from '../desktop/goals';
import { LaunchCoordinator } from '../desktop/launch';
import { restoreLaunchState } from '../desktop/launch-restore';
import { generateRoadmap } from '../desktop/planning';
import { advanceRoadmap } from '../desktop/roadmap';
import { SnapshotStore } from '../runtime/store';
import type { CodexTurnResult, RunTurnOptions } from '../runtime/codex';
import type { DemoAttachment, LocalTaskInput } from '../shared/demo';
import type { AppState, CloudSession, Employee } from '../shared/types';
import { initialState } from '../src/lib/store';

// Browser builds and model responses are fixtures. All coordinators, task files,
// forecast verification, PDF export, reviews, and SQLite persistence run normally.
class LaunchProvider {
  runs: RunTurnOptions[] = [];
  async start() {}
  async readAccount() {
    return { signedIn: true, email: 'launch@example.test' };
  }
  async login(): Promise<{ loginId: string; authUrl: string }> {
    throw new Error('No live login');
  }
  async cancelLogin() {}
  onNotification() {
    return () => {};
  }
  async interrupt() {}
  async close() {}
  async runTurn(options: RunTurnOptions): Promise<CodexTurnResult> {
    this.runs.push(options);
    const ids = { threadId: `thread-${this.runs.length}`, turnId: `turn-${this.runs.length}` };
    await options.onStarted?.(ids);
    let message = 'Verified local deliverable written.';
    if (options.instructions?.startsWith('Generate only')) {
      assert.match(options.prompt, /LITTLE OFFICE LAUNCH/);
      message = JSON.stringify({
        milestones: ['forecast', 'marketing', 'product'].map((step) => ({
          key: step,
          launchStep: step,
          taskKind: step === 'forecast' ? 'report' : step === 'product' ? 'product' : 'meeting',
          title: `Launch ${step}`,
          description: `Complete the supplied launch ${step} assignment with verified files.`,
          ownerId: '',
          dayOffset: 1,
          dependencies: [],
          definitionOfDone: 'Verified local files ready for review',
          nextStep: 'Read the supplied source files',
        })),
      });
    } else {
      const { assignment, files } = JSON.parse(options.prompt) as {
        assignment: string;
        files: DemoAttachment[];
      };
      assert.ok(!files.some((file) => file.name === 'forecast-contract.json'));
      if (options.instructions?.includes('Classify the supplied notification')) {
        const source = JSON.parse(assignment.split('\nSource: ')[1]) as { title: string };
        const kind = source.title.startsWith('Email')
          ? 'report'
          : source.title.startsWith('Slack')
            ? 'bug'
            : 'meeting';
        message = JSON.stringify({
          action: 'create',
          kind,
          title: source.title,
          goal: 'Complete the source request using all attached evidence.',
        });
      } else if (options.instructions?.includes('Write forecast.csv')) {
        const original = files.find((file) => file.name === 'original-forecast.csv');
        const source = original ?? files.find((file) => file.name === 'customers.csv')!;
        assert.ok(source);
        const rows = source.content
          .trim()
          .split('\n')
          .slice(1)
          .map((row) => row.split(','));
        let customers = 120;
        const csv = [
          'month,customers,price_usd,revenue_usd,cost_usd,marketing_spend_usd,operating_contribution_usd',
        ];
        for (const [index, row] of rows.entries()) {
          if (index) customers = Math.round(customers * (original ? 1.03 : 1.11));
          const spend = original ? (index === 1 ? 3000 : Number(row[5])) : Number(row[4]);
          const revenue = customers * 12,
            cost = customers * 2.4;
          csv.push(
            [
              row[0],
              customers,
              12,
              revenue.toFixed(2),
              cost.toFixed(2),
              spend,
              (revenue - cost - spend).toFixed(2),
            ].join(','),
          );
        }
        if (original)
          assert.ok(
            files.some((file) => file.content.includes('Baseline narrative retained after PDF export.')),
          );
        await writeFile(path.join(options.cwd, 'forecast.csv'), `${csv.join('\n')}\n`);
        await writeFile(
          path.join(options.cwd, 'report.md'),
          original
            ? '# Revised forecast\n\nGrowth falls 6 percentage points. Revised narrative retained after PDF export.'
            : '# Baseline forecast\n\nBaseline narrative retained after PDF export.',
        );
      } else {
        const reporter = files.some((file) => file.name === 'revised-forecast.csv');
        if (reporter) {
          assert.ok(
            files.some((file) => file.content.includes('Revised narrative retained after PDF export.')),
          );
          assert.ok(files.some((file) => file.content.includes('One office. Finished work.')));
          assert.ok(files.some((file) => file.content.includes('Fixture verified responsive fix')));
        }
        await writeFile(
          path.join(options.cwd, 'brief.md'),
          reporter
            ? '# Reporter brief\n\nLatest revised forecast and verified responsive fix. Slogan: One office. Finished work.'
            : '# Marketing\n\nOne office. Finished work.',
        );
      }
    }
    return { ...ids, status: 'completed', message };
  }
}

function serialQueue() {
  let tail = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}

test('launch coordinators preserve forecast lineage through sources, reviews, celebration and retakes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'launch-integration-'));
  const store = await SnapshotStore.open(directory);
  const provider = new LaunchProvider();
  const employees = new ChatGPTEmployees(store, path.join(directory, 'employees'), provider);
  const fixtureSessions = new Map<string, CloudSession>();
  const starts: LocalTaskInput[] = [];
  const queue = serialQueue();
  const load = async () => store.get<AppState>('workspace')!;
  const save = (state: AppState) => store.put('workspace', state);
  await save(initialState());
  const get = async (id: string) => fixtureSessions.get(id) ?? employees.get(id);
  const decide = async (id: string, version: number, decision: 'approve', feedback: string) => {
    const fixture = fixtureSessions.get(id);
    if (!fixture) return employees.decide(id, version, decision, feedback);
    fixture.status = 'completed';
    fixture.reviewed = true;
    return structuredClone(fixture);
  };
  const start = async (employee: Employee, assignment: string, state: AppState, task: LocalTaskInput) => {
    starts.push(task);
    if (task.kind !== 'product' && task.kind !== 'bug')
      return employees.start(employee, assignment, state, [], task);
    if (task.kind === 'bug') {
      assert.equal(task.parentSessionId, [...fixtureSessions.values()][0].id);
      assert.equal(task.parentWorkspace, [...fixtureSessions.values()][0].workspace);
      assert.ok(task.files.some((file) => file.encoding === 'base64'));
    }
    const id = `fixture-${randomUUID()}`,
      workspace = path.join(directory, id);
    await mkdir(workspace);
    const filePath = path.join(workspace, task.kind === 'product' ? 'product.md' : 'simulated-pr.md');
    const content =
      task.kind === 'product' ? 'Fixture verified product build' : 'Fixture verified responsive fix';
    await writeFile(filePath, content);
    await writeFile(
      path.join(workspace, 'little-office-launch-bug.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6G6sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const session: CloudSession = {
      id,
      workspace,
      status: 'waiting_for_approval',
      activity: 'Fixture ready',
      location: 'desk',
      events: [],
      output: { title: task.title, content, sources: [], recipient: 'You', version: 1 },
      artifacts: [
        {
          id,
          title: task.title,
          kind: task.kind === 'product' ? 'product' : 'patch',
          filePath,
          content,
          simulated: task.kind === 'bug',
        },
      ],
    };
    fixtureSessions.set(id, session);
    return structuredClone(session);
  };
  const advance = (state: AppState) =>
    advanceRoadmap(state, {
      save,
      getSession: async (id) => {
        const session = await get(id);
        return session.status === 'waiting_for_approval' && (await validateLocalArtifacts(session))
          ? decide(id, session.output!.version, 'approve', 'Validated files')
          : session;
      },
      start: async (employee, assignment, current) =>
        start(employee, assignment, current, await roadmapTask(current, employee.id, get)),
    });
  const goals = new GoalCoordinator({
    load,
    save,
    queue,
    advance,
    generate: (state) =>
      generateRoadmap((prompt, schema) => employees.generate(prompt, schema), {
        goal: state.goal,
        employees: state.employees,
        automatic: true,
        launchId: state.roadmap!.launchId,
      }),
  });
  const demo = new DemoCoordinator({
    load,
    save,
    queue,
    start,
    get,
    decide,
    validateArtifacts: validateLocalArtifacts,
    store: {
      load: async () => store.get<DemoRecord[]>('sources') ?? [],
      save: (records) => store.put('sources', records),
    },
  });
  const launch = new LaunchCoordinator({
    load,
    queue: serialQueue(),
    store: { get: async (key) => store.get(key), put: (key, value) => store.put(key, value) },
    createGoal: (goal, launchId) => goals.create(goal, { automatic: true, launchId }),
    trigger: (input, context) => demo.trigger(input, context),
    demoSnapshot: () => demo.snapshot(),
    getSession: get,
    validateArtifacts: validateLocalArtifacts,
    retryLaunch: async () => {
      throw new Error('Unexpected retry');
    },
    restoreState: (checkpoint, launchId) =>
      queue(async () => save(restoreLaunchState(await load(), checkpoint, launchId))),
  });
  const untilReady = async (scene: 'investor' | 'bug' | 'reporter' | 'celebrate') => {
    for (let attempt = 0; attempt < 200; attempt++) {
      await queue(async () => {
        await advance(await load());
      });
      await demo.tick();
      const snapshot = await launch.snapshot();
      assert.equal(snapshot.status === 'failed', false, JSON.stringify(snapshot.scenes));
      if (snapshot.scenes.find((item) => item.id === scene)?.status === 'ready') return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`Scene ${scene} never became ready: ${JSON.stringify(await load())}`);
  };
  try {
    await launch.start();
    const first = await untilReady('investor');
    assert.deepEqual(
      first.scenes[0].sessionIds.map(
        (id) =>
          starts.find(
            (task) =>
              task.title ===
              (fixtureSessions.get(id)?.output?.title ??
                employees.list().find((session) => session.id === id)?.title),
          )?.launchStep,
      ),
      ['product', 'marketing', 'forecast'],
    );
    assert.equal(
      starts.filter((task) => ['product', 'marketing', 'forecast'].includes(task.launchStep ?? '')).length,
      3,
    );
    const original = await get(first.scenes[0].sessionIds[2]);
    const originalCsv = await readFile(path.join(original.workspace!, 'forecast.csv'), 'utf8');
    assert.equal((await readFile(original.artifacts![0].filePath)).subarray(0, 4).toString(), '%PDF');
    for (const [scene, next] of [
      ['investor', 'bug'],
      ['bug', 'reporter'],
      ['reporter', 'celebrate'],
    ] as const) {
      await launch.advance(scene);
      await untilReady(next);
    }
    await queue(async () => {
      await advance(await load());
    });
    const completed = await launch.advance('celebrate');
    assert.equal(completed.status, 'completed');
    assert.equal(await readFile(path.join(original.workspace!, 'forecast.csv'), 'utf8'), originalCsv);
    const before = await demo.snapshot();
    assert.equal(before.notifications.length, 3);
    assert.ok(before.notifications.every((source) => source.status === 'completed'));
    await launch.restore(first.checkpoints[0].id);
    await launch.advance('investor');
    await untilReady('bug');
    const after = await demo.snapshot();
    assert.equal(after.notifications.length, 4);
    assert.notEqual(after.notifications[0].idempotencyKey, after.notifications[3].idempotencyKey);
    assert.notEqual(after.notifications[0].sessionId, after.notifications[3].sessionId);
    assert.equal(await readFile(path.join(original.workspace!, 'forecast.csv'), 'utf8'), originalCsv);
    assert.ok(provider.runs.every((run) => run.persistent));
  } finally {
    goals.close();
    await employees.close();
    await store.drain();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
