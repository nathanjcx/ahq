import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatGPTEmployees } from '../desktop/chatgpt';
import { SnapshotStore } from '../runtime/store';
import type { CodexAccount, CodexTurnResult, RunTurnOptions } from '../runtime/codex';
import { initialState, sampleState } from '../src/lib/store';
import { applySession } from '../src/lib/workflow';
import { StateSchema } from '../shared/schemas';

class FakeCodex {
  account: CodexAccount = { signedIn: true, email: 'test@example.com', plan: 'plus' };
  listener = (_method: string, _params: Record<string, unknown>) => {};
  runs: RunTurnOptions[] = [];
  waiting = new Map<string, (r: CodexTurnResult) => void>();
  interrupted: string[] = [];
  beforeStarted?: () => Promise<void>;
  async start() {}
  async readAccount() {
    return this.account;
  }
  async login() {
    this.account = { signedIn: true, email: 'test@example.com', plan: 'plus' };
    this.listener('account/login/completed', { loginId: 'login-1', success: true });
    return { loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize?test=1' };
  }
  async cancelLogin() {}
  onNotification(listener: typeof this.listener) {
    this.listener = listener;
    return () => {};
  }
  async runTurn(options: RunTurnOptions): Promise<CodexTurnResult> {
    this.runs.push(options);
    const n = this.runs.length;
    const threadId = options.threadId ?? `thread-${n}`,
      turnId = `turn-${n}`;
    const done = new Promise<CodexTurnResult>((resolve) => this.waiting.set(turnId, resolve));
    if (this.beforeStarted) await this.beforeStarted();
    await options.onStarted?.({ threadId, turnId });
    return done;
  }
  complete(n: number, message = 'Here is the result for your review.') {
    this.waiting.get(`turn-${n}`)!({
      threadId: this.runs[n - 1].threadId ?? `thread-${n}`,
      turnId: `turn-${n}`,
      status: 'completed',
      message,
    });
    this.waiting.delete(`turn-${n}`);
  }
  async interrupt(threadId: string, turnId: string) {
    this.interrupted.push(turnId);
    this.waiting.get(turnId)?.({ threadId, turnId, status: 'interrupted', message: '' });
    this.waiting.delete(turnId);
  }
  async close() {}
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-chatgpt-test-'));
  const store = await SnapshotStore.open(directory);
  const client = new FakeCodex();
  const engine = new ChatGPTEmployees(store, path.join(directory, 'employees'), client);
  return {
    directory,
    store,
    client,
    engine,
    async close() {
      await engine.close();
      await store.drain();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function eventually(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Expected state did not arrive');
}
const employee = sampleState().employees[0];

test('ChatGPT sign-in handles an early completion and never returns OAuth tokens', async () => {
  const f = await fixture();
  try {
    f.client.account = { signedIn: false };
    assert.equal((await f.engine.account()).status, 'signed-out');
    assert.match(await f.engine.login(), /^https:\/\/auth.openai.com/);
    assert.deepEqual(await f.engine.account(), {
      status: 'signed-in',
      email: 'test@example.com',
      plan: 'plus',
    });
    assert.equal(f.store.get('api-keys'), undefined);
  } finally {
    await f.close();
  }
});
test('API-key sign-in cannot start a plan employee or silently fall back to API billing', async () => {
  const f = await fixture();
  try {
    f.client.account = { signedIn: false, unsupportedMethod: 'apiKey' };
    await assert.rejects(
      () => f.engine.start(employee, 'Draft a plan', initialState()),
      /Sign in with ChatGPT/,
    );
    assert.equal(f.client.runs.length, 0);
  } finally {
    await f.close();
  }
});
test('plan assignments persist thread IDs, surface real results, and resume for revisions', async () => {
  const f = await fixture();
  try {
    const s = await f.engine.start(employee, 'Draft a plan', initialState());
    await eventually(() => f.engine.peek(s.id).status === 'running');
    assert.equal(f.client.runs[0].persistent, true);
    assert.equal(f.client.runs[0].model, 'gpt-6-astra');
    assert.equal(f.client.runs[0].modelProvider, 'openai');
    assert.match(f.client.runs[0].instructions!, /nontechnical manager/);
    f.client.complete(1);
    await eventually(() => f.engine.peek(s.id).status === 'waiting_for_approval');
    const reviewed = await f.engine.get(s.id);
    const state = applySession({ ...initialState(), employees: [employee] }, employee.id, reviewed);
    assert.equal(StateSchema.safeParse(state).success, true);
    assert.equal(state.events[0].source, 'chatgpt');
    assert.equal(state.approvals[0].content, 'Here is the result for your review.');
    await assert.rejects(() => f.engine.decide(s.id, 2, 'approve', ''), /review changed/);
    await f.engine.decide(s.id, 1, 'request_changes', 'Make it shorter.');
    assert.equal(f.client.runs[1].threadId, 'thread-1');
    assert.match(f.client.runs[1].prompt, /Make it shorter/);
    f.client.complete(2, 'A shorter result.');
    await eventually(() => f.engine.peek(s.id).status === 'waiting_for_approval');
    assert.equal(f.engine.peek(s.id).output?.version, 2);
    const approved = await f.engine.decide(s.id, 2, 'approve', '');
    assert.equal(approved.reviewed, true);
    assert.equal(approved.status, 'completed');
    const reopened = new ChatGPTEmployees(f.store, f.directory, f.client);
    assert.equal((await reopened.get(s.id)).output?.content, 'A shorter result.');
  } finally {
    await f.close();
  }
});
test('announcement interrupts the active turn before resuming its conversation', async () => {
  const f = await fixture();
  try {
    const s = await f.engine.start(employee, 'Draft a plan', initialState());
    await eventually(() => f.engine.peek(s.id).status === 'running');
    await f.engine.continue(s.id, 'Change direction', true);
    assert.deepEqual(f.client.interrupted, ['turn-1']);
    assert.equal(f.client.runs.length, 2);
    assert.equal(f.client.runs[1].threadId, 'thread-1');
    f.client.complete(2, 'I have followed your new direction.');
    await eventually(() => f.engine.peek(s.id).status === 'waiting_for_approval');
    assert.equal(f.engine.peek(s.id).output?.version, 2);
  } finally {
    await f.close();
  }
});
test('cancel during startup also interrupts the late-starting turn', async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    f.client.beforeStarted = () =>
      new Promise<void>((r) => {
        release = r;
      });
    const s = await f.engine.start(employee, 'Draft a plan', initialState());
    const cancellation = f.engine.cancel(s.id);
    release();
    assert.equal((await cancellation).status, 'completed');
    assert.deepEqual(f.client.interrupted, ['turn-1']);
    assert.equal(f.engine.peek(s.id).output, undefined);
  } finally {
    await f.close();
  }
});
test('account changes cannot continue an employee under a different plan account', async () => {
  const f = await fixture();
  try {
    const s = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.account = { signedIn: true, email: 'different@example.com', plan: 'pro' };
    await assert.rejects(() => f.engine.continue(s.id, 'Continue', true), /account that started/);
    assert.equal(f.client.runs.length, 1);
  } finally {
    await f.close();
  }
});
test('interrupted app state is marked paused after restart without replaying work', async () => {
  const f = await fixture();
  try {
    const s = await f.engine.start(employee, 'Draft a plan', initialState());
    await eventually(() => f.engine.peek(s.id).status === 'running');
    const persisted = f.store.get(`chatgpt-session:${s.id}`);
    await f.engine.cancel(s.id);
    await f.store.put(`chatgpt-session:${s.id}`, persisted);
    const restarted = new ChatGPTEmployees(f.store, f.directory, f.client);
    const recovered = await restarted.get(s.id);
    assert.equal(recovered.status, 'failed');
    assert.match(recovered.activity, /app closed/);
    assert.equal(f.client.runs.length, 1);
  } finally {
    await f.close();
  }
});
