import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatGPTEmployees } from '../desktop/chatgpt';
import { DemoCoordinator, type DemoRecord } from '../desktop/demo';
import { startDemoServer } from '../desktop/demo-server';
import { SnapshotStore } from '../runtime/store';
import type { CodexTurnResult, RunTurnOptions } from '../runtime/codex';
import type { AppState, CloudSession } from '../shared/types';
import type { DemoNotification, DemoSnapshot } from '../shared/demo';
import { initialState } from '../src/lib/store';

// Only the provider is replaced. HTTP, coordination, sessions, files and verification run normally.
class FilesystemCodex {
  runs: RunTurnOptions[] = [];
  async start() {}
  async readAccount() {
    return { signedIn: true, email: 'demo@example.test' };
  }
  async login(): Promise<{ loginId: string; authUrl: string }> {
    throw new Error('The integration test does not sign in.');
  }
  async cancelLogin() {}
  onNotification() {
    return () => {};
  }
  async interrupt() {}
  async close() {}
  async runTurn(options: RunTurnOptions): Promise<CodexTurnResult> {
    this.runs.push(options);
    const number = this.runs.length;
    const threadId = `thread-${number}`,
      turnId = `turn-${number}`;
    await options.onStarted?.({ threadId, turnId });
    options.onMessage?.({
      id: `message-${number}`,
      text: 'Reading supplied files.',
      complete: false,
      timestamp: number,
    });
    const assignment = JSON.parse(options.prompt).assignment as string;
    const source = assignment.match(/Integration (email|meeting|slack)/)?.[1];
    let message: string;
    if (options.instructions?.includes('Classify the supplied notification')) {
      assert.ok(source);
      message = JSON.stringify({
        action: 'create',
        kind: { email: 'report', meeting: 'meeting', slack: 'bug' }[source],
        title: `Integration ${source}`,
        goal: 'Complete the local deliverable from the supplied files.',
      });
    } else {
      if (source === 'email') {
        assert.match(
          await readFile(path.join(options.cwd, 'attachments/1-sales.csv'), 'utf8'),
          /August,Starter,145,25,8/,
        );
        await writeFile(
          path.join(options.cwd, 'report.md'),
          '# Financial report\n\nAugust revenue was $8,545 and costs were $2,800. Gross profit was $5,745. Source: attachments/1-sales.csv.',
        );
      } else if (source === 'meeting') {
        assert.match(
          await readFile(path.join(options.cwd, 'attachments/1-agenda.md'), 'utf8'),
          /Northstar Q3 sales review/,
        );
        await writeFile(
          path.join(options.cwd, 'brief.md'),
          '# Meeting brief\n\nDiscuss August gross profit of $5,745. Proposed action: review next-quarter costs. Source: attachments/2-sales.csv and attachments/1-agenda.md.\n\n## Decisions\nPending discussion.',
        );
      } else {
        assert.equal(source, 'slack');
        const file = path.join(options.cwd, 'checkout.js');
        await writeFile(file, (await readFile(file, 'utf8')).replace(' + (coupon > 0 ? tax : 0)', ''));
        await writeFile(
          path.join(options.cwd, 'patch.md'),
          '# Checkout fix\n\nRemoved the second tax charge on fixed coupons. The runtime must verify the original regression tests.',
        );
      }
      message = `Integration ${source} deliverable written. ` + 'Evidence retained. '.repeat(300);
    }
    options.onMessage?.({ id: `message-${number}`, text: message, complete: true, timestamp: number });
    options.onProgress?.(message);
    return { threadId, turnId, status: 'completed', message };
  }
}

async function validateArtifacts(session: CloudSession): Promise<boolean> {
  if (!session.workspace || !session.artifacts?.length) return false;
  const root = `${await realpath(session.workspace)}${path.sep}`;
  for (const artifact of session.artifacts) {
    const file = await realpath(artifact.filePath);
    if (!file.startsWith(root) || !(await stat(file)).size) return false;
  }
  return true;
}

test('localhost notification POSTs produce reviewed PDF, meeting brief and tested simulated PR', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-http-demo-'));
  const store = await SnapshotStore.open(directory);
  const provider = new FilesystemCodex();
  const employees = new ChatGPTEmployees(store, path.join(directory, 'employees'), provider);
  await store.put('workspace', initialState());
  let queue = Promise.resolve();
  const coordinator = new DemoCoordinator({
    load: async () => store.get<AppState>('workspace')!,
    save: (state) => store.put('workspace', state),
    store: {
      load: async () => store.get<DemoRecord[]>('notifications') ?? [],
      save: (records) => store.put('notifications', records),
    },
    queue: (work) => {
      const result = queue.then(work);
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    start: (employee, assignment, state, task) => employees.start(employee, assignment, state, [], task),
    get: (id) => employees.get(id),
    decide: (id, version, decision, feedback) => employees.decide(id, version, decision, feedback),
    validateArtifacts,
  });
  const server = await startDemoServer({
    directory,
    trigger: (input) => coordinator.trigger(input),
    snapshot: () => coordinator.snapshot(),
  });
  try {
    const { token } = JSON.parse(await readFile(server.connectionPath, 'utf8')) as { token: string };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const ids: string[] = [];
    for (const kind of ['email', 'meeting', 'slack'] as const) {
      const response = await fetch(`${server.address}/notifications`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind,
          title: `Integration ${kind}`,
          idempotencyKey: `take-${kind}`,
          ...(kind === 'slack'
            ? {
                content:
                  'Fix the second tax charge when checkout uses a fixed $10 coupon. Verify $100 at 8% tax with a $10 coupon totals $97.20.',
                attachments: [],
              }
            : {}),
        }),
      });
      assert.equal(response.status, 200);
      ids.push(((await response.json()) as DemoNotification).id);
    }
    let snapshot: DemoSnapshot | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      await coordinator.tick();
      const response = await fetch(`${server.address}/state`, { headers });
      assert.equal(response.status, 200);
      snapshot = (await response.json()) as DemoSnapshot;
      assert.equal(snapshot.notifications.find((n) => n.status === 'failed')?.error, undefined);
      if (snapshot.notifications.every((n) => n.status === 'completed')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(snapshot!.notifications.length, 3);
    assert.ok(snapshot!.notifications.every((n) => n.status === 'completed'));
    assert.equal(provider.runs.length, 6);
    assert.equal(new Set(provider.runs.map((run) => run.cwd)).size, 6);
    assert.ok(provider.runs.every((run) => run.persistent && !run.threadId));
    const sessions = employees.list();
    assert.equal(sessions.length, 6);
    for (const notification of snapshot!.notifications) {
      assert.ok(ids.includes(notification.id));
      const session = sessions.find((s) => s.id === notification.sessionId)!;
      assert.equal(session.status, 'completed');
      assert.equal(session.reviewed, true);
      assert.ok(session.messages!.some((message) => message.complete && message.text.length > 4000));
      assert.ok(await validateArtifacts(session));
      const artifact = session.artifacts![0];
      if (notification.kind === 'email')
        assert.equal((await readFile(artifact.filePath)).subarray(0, 4).toString(), '%PDF');
      if (notification.kind === 'meeting')
        assert.match(await readFile(artifact.filePath, 'utf8'), /Pending discussion/);
      if (notification.kind === 'slack') {
        const pr = session.artifacts!.find((a) => a.simulated)!;
        assert.match(await readFile(pr.filePath, 'utf8'), /Result: passed/);
        assert.match(pr.content, /checkout\.js/);
        assert.match(pr.content, /original regression tests restored/);
      }
    }
    const reopened = new ChatGPTEmployees(store, path.join(directory, 'employees'), new FilesystemCodex());
    assert.deepEqual(reopened.list(), sessions);
    await reopened.close();
    const repeat = await fetch(`${server.address}/notifications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'email', idempotencyKey: 'take-email' }),
    });
    assert.equal(((await repeat.json()) as DemoNotification).id, ids[0]);
    assert.equal(provider.runs.length, 6);
  } finally {
    await server.close();
    await employees.close();
    await store.drain();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
