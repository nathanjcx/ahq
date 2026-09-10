import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SnapshotStore } from '../runtime/store';
import { HostedEmployees } from '../desktop/hosted';
import { initialState } from '../src/lib/store';
const config = {
  key: 'test-key-never-saved',
  model: 'gpt-6-astra',
  integrations: [
    { id: 'abc', name: 'Tracker', url: 'https://tracker.example/mcp', key: 'private-integration-key' },
  ],
};
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ahq-merged-'));
  const store = await SnapshotStore.open(dir);
  return {
    dir,
    store,
    async close() {
      this.store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('checkpoints preserve exact workspace states and the activity journal survives reopen', async () => {
  const f = await fixture();
  try {
    const a = initialState();
    await f.store.saveHQ(a, 'Start', false, 1000);
    const b = {
      ...a,
      goal: 'Deliver a clear plan',
      employees: a.employees.map((e) => ({
        ...e,
        appearance: {
          gender: 'neutral' as const,
          skin: '#ce9a76',
          hair: '#222222',
          hairstyle: 'long' as const,
          hat: 'cap' as const,
          glasses: true,
          clothing: '#426a55',
        },
      })),
    };
    await f.store.saveHQ(b, 'Edit', false, 2000);
    await f.store.saveHQ(b, '5-minute checkpoint', true, 302000);
    assert.equal(f.store.history().length, 3);
    assert.deepEqual(f.store.historyState(1), a);
    assert.deepEqual(f.store.historyState(3), b);
    const journal = f.store.activity();
    assert.ok(journal.some((e) => e.text.includes('Deliver a clear plan')));
    f.store.close();
    f.store = await SnapshotStore.open(f.dir);
    assert.deepEqual(f.store.activity(), journal);
    assert.equal(f.store.get<{ goal: string }>('workspace')?.goal, b.goal);
  } finally {
    await f.close();
  }
});
test('hosted employees use real background responses, persist session IDs, and do not persist API keys', async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  let count = 0;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    count++;
    return new Response(
      JSON.stringify(
        count === 1
          ? { id: 'resp_real', status: 'in_progress', output: [] }
          : {
              id: 'resp_real',
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      text: 'Here is the useful outcome.',
                      annotations: [{ url: 'https://example.com/evidence' }],
                    },
                  ],
                },
              ],
            },
      ),
      { status: 200 },
    );
  };
  try {
    const employee = {
      ...initialState().employees[0],
      skills: 'Astra cloud session, Web search, Tracker',
      sessionId: undefined,
    };
    const engine = new HostedEmployees(f.store, async () => config);
    const started = await engine.start(employee, 'Produce a report', initialState());
    assert.equal(started.status, 'running');
    assert.equal(requests[0].body.background, true);
    assert.equal(requests[0].body.model, 'gpt-6-astra');
    assert.ok(requests[0].url.endsWith('/responses'));
    const raw = JSON.stringify(f.store.get(`session:${started.id}`));
    assert.ok(raw.includes('resp_real'));
    assert.ok(!raw.includes(config.key));
    assert.ok(!raw.includes('private-integration-key'));
    const resumed = new HostedEmployees(f.store, async () => config);
    const finished = await resumed.get(started.id);
    assert.equal(finished.status, 'waiting_for_approval');
    assert.equal(finished.output?.content, 'Here is the useful outcome.');
    assert.deepEqual(finished.output?.sources, ['https://example.com/evidence']);
    await assert.rejects(() => resumed.decide(started.id, 2, 'approve', ''), /review changed/);
    const approved = await resumed.decide(started.id, 1, 'approve', '');
    assert.equal(approved.status, 'completed');
    assert.equal(count, 2);
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
test('integration approval continues only with the reviewed approval ID and fresh credentials', async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  let call = 0;
  let continuation: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    call++;
    if (call === 2) continuation = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify(
        call === 1
          ? {
              id: 'resp_permission',
              status: 'completed',
              output: [
                {
                  type: 'mcp_approval_request',
                  id: 'approval_exact',
                  name: 'create_task',
                  server_label: 'integration_abc',
                  arguments: '{"title":"Review"}',
                },
              ],
            }
          : { id: 'resp_next', status: 'in_progress', output: [] },
      ),
    );
  };
  try {
    const employee = { ...initialState().employees[0], skills: 'Tracker', sessionId: undefined };
    const engine = new HostedEmployees(f.store, async () => config);
    const s = await engine.start(employee, 'Draft a task', initialState());
    assert.equal(s.status, 'waiting_for_approval');
    const next = await engine.decide(s.id, 1, 'approve', '');
    assert.equal(next.status, 'running');
    assert.equal(continuation.previous_response_id, 'resp_permission');
    assert.deepEqual(continuation.input, [
      { type: 'mcp_approval_response', approval_request_id: 'approval_exact', approve: true },
    ]);
    assert.equal(
      (continuation.tools as { authorization: string }[])[0].authorization,
      'private-integration-key',
    );
    assert.ok(!JSON.stringify(f.store.get(`session:${s.id}`)).includes('private-integration-key'));
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
test('broadcast guidance cancels the old turn before starting a new hosted turn', async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  const routes: string[] = [];
  globalThis.fetch = async (url) => {
    routes.push(String(url));
    return new Response(
      JSON.stringify({
        id: routes.length === 1 ? 'resp_first' : 'resp_second',
        status: 'in_progress',
        output: [],
      }),
    );
  };
  try {
    const engine = new HostedEmployees(f.store, async () => config);
    const s = await engine.start(initialState().employees[0], 'Work on a plan', initialState());
    const next = await engine.continue(s.id, 'New announcement: focus on quality', true);
    assert.ok(routes[1].endsWith('/responses/resp_first/cancel'));
    assert.ok(routes[2].endsWith('/responses'));
    assert.equal(next.status, 'running');
    await engine.cancel(s.id);
    assert.equal(engine.peek(s.id).status, 'completed');
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
test('office replay retains microphone levels and holds the same pose while listening', async () => {
  const f = await fixture();
  try {
    await f.store.recordFrame({ time: 1000, sceneTime: 1, listening: false, level: 0, motion: true });
    assert.equal(f.store.frameAt(2000)?.sceneTime, 2);
    await f.store.recordFrame({ time: 3000, sceneTime: 3, listening: true, level: 0.72, motion: true });
    assert.deepEqual(f.store.frameAt(3400), {
      time: 3000,
      sceneTime: 3,
      listening: true,
      level: 0.72,
      motion: true,
    });
    await f.store.recordFrame({ time: 4000, sceneTime: 4, listening: false, level: 0, motion: true });
    assert.equal(f.store.frameAt(5000)?.sceneTime, 5);
  } finally {
    await f.close();
  }
});
test('an approved hosted result reconciles a stale local review after restart', async () => {
  const { applySession } = await import('../src/lib/workflow');
  const state = initialState();
  const employee = state.employees[0];
  const output = { title: 'A plan', content: 'Completed work', sources: [], recipient: 'You', version: 1 };
  const waiting = {
    id: 'astra-recovery',
    status: 'waiting_for_approval' as const,
    activity: 'Ready',
    location: 'board' as const,
    events: [],
    output,
  };
  const before = applySession(state, employee.id, waiting);
  const after = applySession(before, employee.id, { ...waiting, status: 'completed', reviewed: true });
  assert.equal(after.approvals.find((a) => a.sessionId === waiting.id)?.status, 'approved');
  assert.equal(after.employees[0].status, 'ready');
});
test('activity CSV preserves multiline text without interpreting it as a spreadsheet formula', async () => {
  const { activityExport } = await import('../shared/activity');
  const event = {
    id: 'e',
    time: new Date().toISOString(),
    text: '=HYPERLINK("https://example.com")\nsecond line',
    kind: 'work' as const,
    source: 'cloud' as const,
  };
  const csv = activityExport([event], 'csv');
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")\nsecond line"'));
  assert.deepEqual(JSON.parse(activityExport([event], 'json')), [event]);
});
