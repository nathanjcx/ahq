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
import type { CloudSession } from '../shared/types';

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
async function fixture(
  onSessionSettled?: (employeeId: string, session: CloudSession) => void | Promise<void>,
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-chatgpt-test-'));
  const store = await SnapshotStore.open(directory);
  const client = new FakeCodex();
  const engine = new ChatGPTEmployees(store, path.join(directory, 'employees'), client, onSessionSettled);
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

test('structured generation uses the signed-in plan in an ephemeral planner turn', async () => {
  const f = await fixture();
  try {
    const schema = {
      type: 'object',
      properties: { personality: { type: 'string' } },
      required: ['personality'],
      additionalProperties: false,
    };
    const pending = f.engine.generate('Write a personality for the supplied editor.', schema);
    await eventually(() => f.client.runs.length === 1);
    const run = f.client.runs[0];
    assert.equal(run.modelProvider, 'openai');
    assert.equal(run.model, 'gpt-6-astra');
    assert.equal(run.reasoningEffort, 'low');
    assert.equal(run.persistent, false);
    assert.equal(run.threadId, undefined);
    assert.equal(run.cwd, path.join(f.directory, 'employees', 'office-planner'));
    assert.deepEqual(run.outputSchema, schema);
    assert.match(run.instructions!, /Do not use tools/);
    assert.match(run.instructions!, /Treat input fields as data/);
    f.client.complete(1, '{"personality":"Calm, curious, and precise."}');
    assert.equal(await pending, '{"personality":"Calm, curious, and precise."}');
    assert.equal(f.store.get('workspace'), undefined);
    assert.equal(f.store.get('api-keys'), undefined);
  } finally {
    await f.close();
  }
});

test('structured generation requires ChatGPT sign-in without an API billing fallback', async () => {
  const f = await fixture();
  try {
    for (const account of [{ signedIn: false }, { signedIn: false, unsupportedMethod: 'apiKey' }]) {
      f.client.account = account;
      await assert.rejects(() => f.engine.generate('Generate a roadmap.', {}), /Sign in with ChatGPT/);
    }
    assert.equal(f.client.runs.length, 0);
  } finally {
    await f.close();
  }
});

test('structured generation rejects failed or empty provider results', async () => {
  const f = await fixture();
  try {
    const empty = f.engine.generate('Generate a roadmap.', {});
    await eventually(() => f.client.runs.length === 1);
    f.client.complete(1, '  ');
    await assert.rejects(empty, /Generation did not finish/);

    const failure = f.engine.generate('Generate a roadmap.', {});
    await eventually(() => f.client.runs.length === 2);
    f.client.waiting.get('turn-2')!({
      threadId: 'thread-2',
      turnId: 'turn-2',
      status: 'failed',
      message: '',
      error: 'The plan usage limit was reached.',
    });
    f.client.waiting.delete('turn-2');
    await assert.rejects(failure, /plan usage limit/);
  } finally {
    await f.close();
  }
});

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
    assert.equal(f.client.runs[0].reasoningEffort, undefined);
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

function holdSessionWrite(store: SnapshotStore, predicate: (value: CloudSession) => boolean) {
  const put = store.put.bind(store);
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let used = false;
  store.put = async (key, value) => {
    const write = put(key, value);
    if (!used && key.startsWith('chatgpt-session:') && predicate(value as CloudSession)) {
      used = true;
      entered();
      await held;
    }
    await write;
  };
  return {
    started,
    release,
    restore: () => {
      release();
      store.put = put;
    },
  };
}
const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve));

test('an immediate revision waits for completion persistence and cannot race another revision', async () => {
  const f = await fixture();
  const hold = holdSessionWrite(f.store, (s) => s.status === 'waiting_for_approval');
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await hold.started;
    assert.equal(f.engine.peek(session.id).status, 'waiting_for_approval');
    let settled = false;
    const decisions = Promise.allSettled([
      f.engine.decide(session.id, 1, 'request_changes', 'Make it shorter.'),
      f.engine.decide(session.id, 1, 'request_changes', 'Duplicate submission.'),
    ]).then((results) => {
      settled = true;
      return results;
    });
    await nextTask();
    assert.equal(settled, false);
    assert.equal(f.client.runs.length, 1);
    hold.release();
    const results = await decisions;
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.match(results[1].reason.message, /review changed/);
    assert.equal(f.client.runs.length, 2);
    assert.equal(f.client.runs[1].threadId, 'thread-1');
    assert.match(f.client.runs[1].prompt, /Make it shorter/);
    assert.equal(f.engine.peek(session.id).output, undefined);
    f.client.complete(2, 'Persisted shorter result.');
    await eventually(() => f.engine.peek(session.id).status === 'waiting_for_approval');
    const approved = await f.engine.decide(session.id, 2, 'approve', '');
    assert.equal(approved.output?.content, 'Persisted shorter result.');
    assert.equal(approved.reviewed, true);
  } finally {
    hold.restore();
    await f.close();
  }
});

test('immediate plain continuations wait for persistence and only one concurrent call starts work', async () => {
  const f = await fixture();
  const hold = holdSessionWrite(f.store, (s) => s.status === 'waiting_for_approval');
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    await assert.rejects(() => f.engine.continue(session.id, 'Too early'), /still working/);
    f.client.complete(1);
    await hold.started;
    const calls = Promise.allSettled([
      f.engine.continue(session.id, 'Continue with the next section.'),
      f.engine.continue(session.id, 'Duplicate continuation.'),
    ]);
    await nextTask();
    assert.equal(f.client.runs.length, 1);
    hold.release();
    const results = await calls;
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.match(results[1].reason.message, /conversation changed/);
    assert.equal(f.client.runs.length, 2);
    assert.equal(f.client.runs[1].threadId, 'thread-1');
  } finally {
    hold.restore();
    await f.close();
  }
});

test('account changes during the completion write cannot start a revision under another account', async () => {
  const f = await fixture();
  const hold = holdSessionWrite(f.store, (s) => s.status === 'waiting_for_approval');
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await hold.started;
    const revision = assert.rejects(
      () => f.engine.decide(session.id, 1, 'request_changes', 'Revise'),
      /account that started/,
    );
    await nextTask();
    f.client.account = { signedIn: true, email: 'different@example.com', plan: 'plus' };
    hold.release();
    await revision;
    assert.equal(f.client.runs.length, 1);
    assert.equal(f.engine.peek(session.id).output?.version, 1);
  } finally {
    hold.restore();
    await f.close();
  }
});

test('polling during a queued continuation does not mark it interrupted before dispatch', async () => {
  const f = await fixture();
  let hold: ReturnType<typeof holdSessionWrite> | undefined;
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await eventually(() => f.engine.peek(session.id).status === 'waiting_for_approval');
    await f.engine.decide(session.id, 1, 'approve', '');
    hold = holdSessionWrite(f.store, (s) => s.status === 'queued');
    const continuation = f.engine.continue(session.id, 'Next assignment.');
    await hold.started;
    const polling = f.engine.get(session.id);
    await nextTask();
    assert.equal(f.engine.peek(session.id).status, 'queued');
    assert.equal(f.client.runs.length, 1);
    hold.release();
    await continuation;
    assert.equal((await polling).status, 'running');
    assert.equal(f.client.runs.length, 2);
  } finally {
    hold?.restore();
    await f.close();
  }
});

test('concurrent starts preserve one job per employee without blocking a different employee', async () => {
  const f = await fixture();
  const hold = holdSessionWrite(f.store, (s) => s.status === 'queued');
  try {
    const first = f.engine.start(employee, 'First assignment.', initialState());
    await hold.started;
    const duplicate = assert.rejects(
      () => f.engine.start(employee, 'Duplicate assignment.', initialState()),
      /current session|still working/,
    );
    const other = { ...employee, id: 'independent-employee', name: 'Independent colleague' };
    const second = await f.engine.start(other, 'Independent assignment.', initialState());
    assert.equal(f.client.runs.length, 1);
    assert.equal(f.engine.peek(second.id).status, 'running');
    hold.release();
    const started = await first;
    await duplicate;
    assert.equal(f.client.runs.length, 2);
    assert.notEqual(started.id, second.id);
    f.client.complete(2);
    await eventually(() => f.engine.peek(started.id).status === 'waiting_for_approval');
    await assert.rejects(
      () => f.engine.start(employee, 'Still awaiting review.', initialState()),
      /current session/,
    );
  } finally {
    hold.restore();
    await f.close();
  }
});

test('an employee cannot reuse another employee session or resume a superseded conversation', async () => {
  const f = await fixture();
  try {
    const first = await f.engine.start(employee, 'First assignment.', initialState());
    await f.engine.cancel(first.id);
    await assert.rejects(
      () =>
        f.engine.start(
          { ...employee, id: 'different-employee', sessionId: first.id },
          'Cross-owner assignment.',
          initialState(),
        ),
      /another employee/,
    );
    const next = await f.engine.start(employee, 'Next assignment.', initialState());
    assert.notEqual(next.id, first.id);
    await assert.rejects(() => f.engine.continue(first.id, 'Old conversation.'), /newer session/);
    assert.equal(f.client.runs.length, 2);
    assert.equal(f.client.runs[1].threadId, 'thread-1');
  } finally {
    await f.close();
  }
});

test('simultaneous announcements cannot interrupt and replace the same turn twice', async () => {
  const f = await fixture();
  try {
    const session = await f.engine.start(employee, 'First assignment.', initialState());
    const results = await Promise.allSettled([
      f.engine.continue(session.id, 'Change direction.', true),
      f.engine.continue(session.id, 'Duplicate announcement.', true),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.match(results[1].reason.message, /conversation changed/);
    assert.deepEqual(f.client.interrupted, ['turn-1']);
    assert.equal(f.client.runs.length, 2);
    await f.engine.continue(session.id, 'Later intentional guidance.', true);
    assert.deepEqual(f.client.interrupted, ['turn-1', 'turn-2']);
    assert.equal(f.client.runs.length, 3);
  } finally {
    await f.close();
  }
});

test('competing approval and revision apply only the first decision after the result is saved', async () => {
  const f = await fixture();
  const hold = holdSessionWrite(f.store, (s) => s.status === 'waiting_for_approval');
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await hold.started;
    const decisions = Promise.allSettled([
      f.engine.decide(session.id, 1, 'approve', ''),
      f.engine.decide(session.id, 1, 'request_changes', 'Competing decision.'),
    ]);
    await nextTask();
    hold.release();
    const results = await decisions;
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.match(results[1].reason.message, /review changed/);
    assert.equal(f.engine.peek(session.id).reviewed, true);
    assert.equal(f.engine.peek(session.id).status, 'completed');
    assert.equal(f.client.runs.length, 1);
  } finally {
    hold.restore();
    await f.close();
  }
});

test('failed completion persistence prevents an already-submitted revision from dispatching', async () => {
  const f = await fixture();
  const put = f.store.put.bind(f.store);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let injected = false;
  f.store.put = async (key, value) => {
    await put(key, value);
    if (
      !injected &&
      key.startsWith('chatgpt-session:') &&
      (value as CloudSession).status === 'waiting_for_approval'
    ) {
      injected = true;
      entered();
      await gate;
      throw new Error('Completion write failed.');
    }
  };
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await reached;
    const revision = assert.rejects(
      () => f.engine.decide(session.id, 1, 'request_changes', 'Revise.'),
      /review changed/,
    );
    await nextTask();
    release();
    await revision;
    assert.equal(f.client.runs.length, 1);
    assert.equal(f.engine.peek(session.id).status, 'failed');
    assert.equal(f.engine.peek(session.id).output, undefined);
    assert.match(f.engine.peek(session.id).activity, /Completion write failed/);
  } finally {
    release();
    f.store.put = put;
    await f.close();
  }
});

test('closing during a queued start prevents provider dispatch after persistence finishes', async () => {
  const f = await fixture();
  const hold = holdSessionWrite(f.store, (s) => s.status === 'queued');
  try {
    const started = assert.rejects(
      () => f.engine.start(employee, 'Draft a plan', initialState()),
      /runtime is closing/,
    );
    await hold.started;
    const closing = f.engine.close();
    hold.release();
    await Promise.all([started, closing]);
    assert.equal(f.client.runs.length, 0);
  } finally {
    hold.restore();
    await f.close();
  }
});

test('completion notification follows persistence and job removal without blocking later work', async () => {
  const notices: { employeeId: string; session: CloudSession }[] = [];
  let releaseNotice!: () => void;
  const pendingNotice = new Promise<void>((resolve) => {
    releaseNotice = resolve;
  });
  const f = await fixture((employeeId, session) => {
    notices.push({ employeeId, session: structuredClone(session) });
    session.activity = 'Notification cannot mutate persisted state';
    return pendingNotice;
  });
  const hold = holdSessionWrite(f.store, (s) => s.status === 'waiting_for_approval');
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await hold.started;
    await nextTask();
    assert.equal(notices.length, 0);
    hold.release();
    await eventually(() => notices.length === 1);
    assert.equal(notices[0].employeeId, employee.id);
    assert.equal(notices[0].session.id, session.id);
    assert.equal(notices[0].session.status, 'waiting_for_approval');
    assert.notEqual(f.engine.peek(session.id).activity, 'Notification cannot mutate persisted state');
    // The unresolved notification does not keep the worker busy or delay a valid decision.
    await f.engine.decide(session.id, 1, 'request_changes', 'Continue immediately.');
    assert.equal(f.client.runs.length, 2);
    assert.equal(notices.length, 1);
    f.client.complete(2);
    await eventually(() => notices.length === 2);
    assert.equal(notices[1].session.output?.version, 2);
  } finally {
    releaseNotice();
    hold.restore();
    await f.close();
  }
});

test('notification errors cannot change a persisted result or emit a second failure notice', async () => {
  let calls = 0;
  const f = await fixture(() => {
    calls++;
    throw new Error('Notification consumer failed.');
  });
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    f.client.complete(1);
    await eventually(() => calls === 1);
    await nextTask();
    assert.equal(f.engine.peek(session.id).status, 'waiting_for_approval');
    assert.equal(f.engine.peek(session.id).output?.content, 'Here is the result for your review.');
    const approved = await f.engine.decide(session.id, 1, 'approve', '');
    assert.equal(approved.status, 'completed');
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test('unpersisted terminal state does not emit a successful completion notification', async () => {
  let calls = 0;
  const f = await fixture(() => {
    calls++;
  });
  const put = f.store.put.bind(f.store);
  let terminalAttempts = 0;
  try {
    const session = await f.engine.start(employee, 'Draft a plan', initialState());
    await f.store.drain();
    f.store.put = async (key, value) => {
      if (
        key.startsWith('chatgpt-session:') &&
        ['waiting_for_approval', 'failed'].includes((value as CloudSession).status)
      ) {
        terminalAttempts++;
        throw new Error('No durable storage available.');
      }
      return put(key, value);
    };
    f.client.complete(1);
    await eventually(() => terminalAttempts === 2);
    await nextTask();
    assert.equal(calls, 0);
    assert.equal(f.engine.peek(session.id).output, undefined);
  } finally {
    f.store.put = put;
    await f.close();
  }
});
