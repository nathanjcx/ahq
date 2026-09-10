import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostedEmployees } from '../desktop/hosted';
import type { AgentToolContext, AgentToolRuntime } from '../desktop/agent-tools';
import { defaultAgentConfig } from '../shared/agent-config';
import { SnapshotStore } from '../runtime/store';
import { initialState } from '../src/lib/store';

const credentials = {
  key: 'private-api-key',
  model: 'gpt-6-astra',
  integrations: [
    { id: 'tracker', name: 'Tracker', url: 'https://tracker.example/mcp', key: 'private-integration-key' },
  ],
};
const message = (text: string) => ({ type: 'message', content: [{ type: 'output_text', text }] });
const call = (id: string, name = 'test_tool', args = '{}') => ({
  type: 'function_call',
  call_id: id,
  name,
  arguments: args,
});
const response = (id: string, output: unknown[], status = 'completed', usage?: unknown) =>
  new Response(JSON.stringify({ id, status, output, usage }));
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-agent-session-'));
  const store = await SnapshotStore.open(directory);
  const state = initialState();
  const agent = defaultAgentConfig();
  agent.autonomy.completionReview = false;
  agent.autonomy.toolApproval = 'allow';
  const employee = { ...state.employees[0], sessionId: undefined, agent };
  const previousFetch = globalThis.fetch;
  return {
    store,
    state,
    employee,
    async close() {
      globalThis.fetch = previousFetch;
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function toolbox(execute: AgentToolRuntime['execute'], requiresApproval = false): AgentToolRuntime {
  return {
    definitions: () => [
      { type: 'function', name: 'test_tool', parameters: { type: 'object', properties: {} } },
    ],
    context: () => ({ memories: ['A verified preference'] }),
    execute,
    requiresApproval: () => requiresApproval,
  };
}

test('provider tools and summaries have distinct auditable provenance and exact service names', async () => {
  const f = await fixture();
  globalThis.fetch = async () =>
    response('r-provider-audit', [
      {
        type: 'reasoning',
        id: 'summary1',
        summary: [{ type: 'summary_text', text: 'Checked the returned evidence.' }],
      },
      { type: 'web_search_call', id: 'search1', status: 'completed' },
      { type: 'code_interpreter_call', id: 'analysis1', status: 'failed' },
      {
        type: 'mcp_call',
        id: 'service1',
        server_label: 'integration_tracker',
        name: 'list_tasks',
        status: 'completed',
      },
      message('Completed the evidence review.'),
    ]);
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const result = await runtime.start(f.employee, 'Review the returned evidence', f.state);
    assert.equal(result.status, 'completed');
    const events = f.store.exportOfficeAudit().ledger;
    const starts = events.filter((event) => event.kind === 'tool.started');
    assert.deepEqual(
      starts.map((event) => event.toolName),
      ['web_search_call', 'code_interpreter_call', 'mcp_integration_tracker_list_tasks'],
    );
    assert.ok(starts.every((event) => event.source === 'provider'));
    assert.equal(events.filter((event) => event.kind === 'tool.completed').length, 2);
    assert.equal(events.filter((event) => event.kind === 'tool.failed').length, 1);
    assert.equal(events.filter((event) => event.kind === 'reasoning.summary').length, 1);
    assert.ok(
      events
        .filter((event) => event.kind.startsWith('tool.'))
        .every((event) => event.responseId === 'r-provider-audit'),
    );
    assert.equal(f.store.exportOfficeAudit().verification.verified, true);
  } finally {
    await f.close();
  }
});

test('Astra session completes multiple real protocol tool turns with durable receipts and usage', async () => {
  const f = await fixture();
  const requests: Record<string, unknown>[] = [];
  const contexts: AgentToolContext[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return requests.length === 1
      ? response('r1', [call('c1')], 'completed', { input_tokens: 10, output_tokens: 20 })
      : requests.length === 2
        ? response('r2', [call('c2')], 'completed', { input_tokens: 15, output_tokens: 25 })
        : response('r3', [message('Finished with the tool evidence.')], 'completed', {
            input_tokens: 20,
            output_tokens: 30,
          });
  };
  try {
    f.employee.agent.reasoning = 'max';
    f.employee.agent.tools.integrationIds = ['tracker'];
    const runtime = new HostedEmployees(
      f.store,
      async () => credentials,
      toolbox(async (_name, _args, context) => {
        contexts.push(context);
        return { answer: contexts.length };
      }),
    );
    const result = await runtime.start(f.employee, 'Complete this assignment', f.state, [], { depth: 2 });
    assert.equal(result.status, 'completed');
    assert.equal(contexts.length, 2);
    assert.equal(contexts[0].depth, 2);
    assert.equal(requests[0].model, 'gpt-6-astra');
    assert.deepEqual(requests[0].reasoning, { effort: 'max', summary: 'auto' });
    assert.equal(requests[1].previous_response_id, 'r1');
    assert.equal(requests[2].previous_response_id, 'r2');
    assert.deepEqual(requests[1].input, [
      { type: 'function_call_output', call_id: 'c1', output: '{"answer":1}' },
    ]);
    assert.deepEqual(result.usage, {
      inputTokens: 45,
      outputTokens: 75,
      totalTokens: 120,
      turns: 3,
      toolCalls: 2,
    });
    assert.equal(result.toolCalls?.length, 2);
    assert.equal(result.config?.reasoning, 'max');
    const saved = JSON.stringify(f.store.get(`session:${result.id}`));
    assert.ok(!saved.includes(credentials.key));
    assert.ok(!saved.includes('private-integration-key'));
    assert.equal(requests[0].max_tool_calls, 40);
    assert.match(String(requests[0].input), /A verified preference/);
  } finally {
    await f.close();
  }
});

test('restart retries saved continuation and never executes a completed tool twice', async () => {
  const f = await fixture();
  let executed = 0;
  let requestCount = 0;
  const keys: string[] = [];
  globalThis.fetch = async (_url, init) => {
    requestCount++;
    keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
    if (requestCount === 1) return response('r-tool', [call('durable')]);
    if (requestCount === 2) throw new TypeError('fixture transport failure');
    return response('r-result', [message('Recovered result')]);
  };
  try {
    const tools = toolbox(async () => {
      executed++;
      return { persisted: true };
    });
    const first = new HostedEmployees(f.store, async () => credentials, tools);
    await assert.rejects(first.start(f.employee, 'Write once', f.state), /fixture transport/);
    const id = f.store.get<string>(`employee-session:${f.employee.id}`)!;
    assert.equal(executed, 1);
    const resumed = new HostedEmployees(f.store, async () => credentials, tools);
    const result = await resumed.get(id);
    assert.equal(result.status, 'completed');
    assert.equal(executed, 1);
    assert.equal(keys[1], keys[2]);
    assert.equal(result.usage?.toolCalls, 1);
    assert.equal(result.usage?.turns, 2);
  } finally {
    await f.close();
  }
});

test('manager guidance queues during work and later preserves the response chain and refreshed configuration', async () => {
  const f = await fixture();
  const requests: { url: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (requests.length === 1) return response('original', [], 'in_progress');
    if (requests.length === 2) return response('original', [message('Original result')]);
    if (requests.length === 3) return response('guided', [message('Updated result')]);
    return response('next-assignment', [message('Next assignment done')]);
  };
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const started = await runtime.start(f.employee, 'Original assignment', f.state);
    const changed = { ...f.employee, agent: { ...f.employee.agent, revision: 2, reasoning: 'low' as const } };
    const queued = await runtime.continue(started.id, 'Use the new requirement', true, {
      employee: changed,
      state: f.state,
    });
    assert.equal(requests.length, 1);
    assert.equal(queued.configRevision, 1);
    const completed = await runtime.get(started.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.configRevision, 2);
    assert.equal(requests[2].body?.previous_response_id, 'original');
    assert.match(String(requests[2].body?.input), /new requirement/);
    assert.ok(!requests.some((r) => r.url.endsWith('/cancel')));
    const restarted = new HostedEmployees(f.store, async () => credentials);
    const next = await restarted.start(changed, 'Next assignment', f.state);
    assert.equal(next.id, started.id);
    assert.equal(requests[3].body?.previous_response_id, 'guided');
  } finally {
    await f.close();
  }
});

test('tool approval is exact, rejects stale decisions, and denial never executes the mutation', async () => {
  const f = await fixture();
  let executed = 0;
  const requests: Record<string, unknown>[] = [];
  f.employee.agent.autonomy.toolApproval = 'ask';
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return requests.length === 1
      ? response('pending', [call('approval', 'test_tool', '{"title":"Exact title"}')])
      : response('denied', [message('The action was declined.')]);
  };
  try {
    const runtime = new HostedEmployees(
      f.store,
      async () => credentials,
      toolbox(async () => {
        executed++;
        return {};
      }, true),
    );
    const s = await runtime.start(f.employee, 'Prepare an action', f.state);
    assert.equal(s.status, 'waiting_for_approval');
    assert.match(s.output?.content ?? '', /Exact title/);
    assert.equal(executed, 0);
    await assert.rejects(runtime.decide(s.id, 2, 'approve', ''), /review changed/);
    await runtime.decide(s.id, 1, 'request_changes', 'Do not do this');
    assert.equal(executed, 0);
    assert.match(JSON.stringify(requests[1].input), /declined/);
  } finally {
    await f.close();
  }
});

test('approved office tool receives only the reviewed arguments and approval flag', async () => {
  const f = await fixture();
  let executed: { args: unknown; approved?: boolean } | undefined;
  let n = 0;
  f.employee.agent.autonomy.toolApproval = 'ask';
  globalThis.fetch = async () =>
    ++n === 1
      ? response('approval', [call('exact', 'test_tool', '{"value":42}')])
      : response('done', [message('Action verified')]);
  try {
    const runtime = new HostedEmployees(
      f.store,
      async () => credentials,
      toolbox(async (_name, args, context) => {
        executed = { args, approved: context.approved };
        return { success: true };
      }, true),
    );
    const s = await runtime.start(f.employee, 'Act when approved', f.state);
    await runtime.decide(s.id, s.output!.version, 'approve', '');
    assert.deepEqual(executed, { args: { value: 42 }, approved: true });
  } finally {
    await f.close();
  }
});

test('configured tool, turn, token, and runtime limits stop follow-up dispatch', async () => {
  for (const bound of ['tool', 'turn', 'token', 'runtime'] as const) {
    const f = await fixture();
    let requests = 0;
    let executions = 0;
    if (bound === 'tool') f.employee.agent.limits.maxToolCalls = 0;
    if (bound === 'turn') f.employee.agent.limits.maxTurns = 1;
    if (bound === 'token') {
      f.employee.agent.limits.maxOutputTokens = 256;
      f.employee.agent.limits.maxRunTokens = 1024;
    }
    globalThis.fetch = async () => {
      requests++;
      return response(
        'bounded',
        bound === 'runtime' ? [] : [call('bounded')],
        bound === 'runtime' ? 'in_progress' : 'completed',
        bound === 'token' ? { input_tokens: 1000, output_tokens: 30 } : undefined,
      );
    };
    try {
      const runtime = new HostedEmployees(
        f.store,
        async () => credentials,
        toolbox(async () => {
          executions++;
          return {};
        }),
      );
      let s = await runtime.start(f.employee, 'Bounded assignment', f.state);
      if (bound === 'runtime') {
        const stored = f.store.get<Record<string, unknown>>(`session:${s.id}`)!;
        await f.store.put(`session:${s.id}`, { ...stored, startedAt: Date.now() - 31 * 60_000 });
        s = await runtime.get(s.id);
      }
      assert.equal(s.status, 'failed', bound);
      assert.equal(requests, bound === 'runtime' ? 2 : 1, bound);
      assert.equal(executions, 0, bound);
    } finally {
      await f.close();
    }
  }
});

test('no prose skill can grant a tool and non-Astra config is rejected before provider calls', async () => {
  const f = await fixture();
  let requests = 0;
  let tools: unknown;
  globalThis.fetch = async (_url, init) => {
    requests++;
    tools = JSON.parse(String(init?.body)).tools;
    return response('done', [message('Done')]);
  };
  try {
    f.employee.skills = 'Web search, Data analysis, Tracker';
    const runtime = new HostedEmployees(f.store, async () => credentials);
    await runtime.start(f.employee, 'Follow explicit config', f.state);
    assert.deepEqual(tools, []);
    const other = new HostedEmployees(f.store, async () => ({ ...credentials, model: 'gpt-other' }));
    await assert.rejects(other.start(f.employee, 'Use invalid transport', f.state), /require gpt-6-astra/);
    assert.equal(requests, 1);
  } finally {
    await f.close();
  }
});

test('empty completed output fails and failed provider tool items never claim success', async () => {
  const f = await fixture();
  globalThis.fetch = async () =>
    response('empty', [{ type: 'web_search_call', id: 'search-failed', status: 'failed' }]);
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const s = await runtime.start(f.employee, 'Find evidence', f.state);
    assert.equal(s.status, 'failed');
    assert.match(s.activity, /without a written result/);
    assert.ok(!s.events.some((e) => /Checked sources/.test(e.text)));
  } finally {
    await f.close();
  }
});

test('cancel aborts active polling without blocking another employee and remains cancelled after restart', async () => {
  const f = await fixture();
  let polled!: () => void;
  const polling = new Promise<void>((resolve) => {
    polled = resolve;
  });
  let aborted = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/responses')) return response('running', [], 'in_progress');
    if (String(url).endsWith('/cancel')) return response('running', [], 'cancelled');
    polled();
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(new Error('poll aborted'));
        },
        { once: true },
      ),
    );
  };
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const s = await runtime.start(f.employee, 'Keep working', f.state);
    const poll = runtime.get(s.id);
    const caught = poll.catch(() => undefined);
    await polling;
    const other = await runtime.start(
      { ...f.employee, id: 'independent-employee' },
      'Independent work',
      f.state,
    );
    assert.equal(other.status, 'running');
    const stopped = await runtime.cancel(s.id);
    await caught;
    assert.equal(aborted, true);
    assert.equal(stopped.status, 'cancelled');
    assert.equal(new HostedEmployees(f.store, async () => credentials).peek(s.id).status, 'cancelled');
  } finally {
    await f.close();
  }
});

test('session ownership and per-employee start serialization prevent crossed and duplicate sessions', async () => {
  const f = await fixture();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return response(`r${requests}`, [], 'in_progress');
  };
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const starts = await Promise.allSettled([
      runtime.start(f.employee, 'One', f.state),
      runtime.start(f.employee, 'Two', f.state),
    ]);
    assert.equal(starts.filter((s) => s.status === 'fulfilled').length, 1);
    assert.equal(requests, 1);
    const first = starts.find((s) => s.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof runtime.start>>
    >;
    assert.equal(runtime.ownerOf(first.value.id), f.employee.id);
    const other = { ...f.employee, id: 'wrong-owner', sessionId: first.value.id };
    await assert.rejects(runtime.start(other, 'Crossed assignment', f.state), /different employee/);
    await assert.rejects(
      runtime.continue(first.value.id, 'Crossed guidance', false, { employee: other }),
      /different employee/,
    );
    assert.equal(requests, 1);
  } finally {
    await f.close();
  }
});

test('disabled file and communication grants exclude their content from the model input', async () => {
  const f = await fixture();
  let input = '';
  f.employee.agent.tools.workspaceRead = false;
  f.employee.agent.communication.receiveMessages = false;
  f.employee.agent.communication.receiveAnnouncements = false;
  f.state.messages = [
    {
      id: 'announcement',
      authorId: 'you',
      channel: 'announce',
      text: 'Excluded announcement',
      time: new Date().toISOString(),
    },
    {
      id: 'team',
      authorId: 'teammate',
      channel: 'team',
      text: 'Excluded teammate message',
      time: new Date().toISOString(),
    },
    {
      id: 'manager',
      authorId: 'you',
      channel: f.employee.id,
      text: 'Included manager instruction',
      time: new Date().toISOString(),
    },
  ];
  globalThis.fetch = async (_url, init) => {
    input = String(JSON.parse(String(init?.body)).input);
    return response('done', [message('Done')]);
  };
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    await runtime.start(f.employee, 'Respect permissions', f.state, [
      { path: 'notes.md', content: 'Excluded file content' },
    ]);
    assert.match(input, /Included manager instruction/);
    assert.doesNotMatch(input, /Excluded/);
  } finally {
    await f.close();
  }
});

test('provider-managed calls are counted once across polls and consume the shared tool budget', async () => {
  const f = await fixture();
  let n = 0;
  f.employee.agent.tools.webSearch = true;
  f.employee.agent.limits.maxToolCalls = 1;
  globalThis.fetch = async () => {
    n++;
    return response(
      'provider-tools',
      [
        { type: 'web_search_call', id: 'search-1', status: n < 3 ? 'in_progress' : 'completed' },
        ...(n === 3 ? [message('Found evidence')] : []),
      ],
      n < 3 ? 'in_progress' : 'completed',
    );
  };
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const s = await runtime.start(f.employee, 'Find evidence', f.state);
    assert.equal(s.usage?.toolCalls, 1);
    await runtime.get(s.id);
    const done = await runtime.get(s.id);
    assert.equal(done.usage?.toolCalls, 1);
    assert.equal(done.toolCalls?.[0].status, 'completed');
    assert.equal(done.status, 'completed');
  } finally {
    await f.close();
  }
});

test('shutdown aborts local transport, rejects new work, and drains writes before SQLite closes', async () => {
  const f = await fixture();
  let polled!: () => void;
  const polling = new Promise<void>((resolve) => {
    polled = resolve;
  });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/responses')) return response('surviving-response', [], 'in_progress');
    polled();
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('shutdown abort')), { once: true }),
    );
  };
  try {
    const runtime = new HostedEmployees(f.store, async () => credentials);
    const s = await runtime.start(f.employee, 'Persist across shutdown', f.state);
    const running = runtime.get(s.id).catch(() => undefined);
    await polling;
    assert.equal(runtime.busy, true);
    await runtime.close();
    await running;
    assert.equal(runtime.busy, false);
    await assert.rejects(runtime.start(f.employee, 'Too late', f.state), /closing/);
    const saved = f.store.get<{ responseId: string; status: string }>(`session:${s.id}`)!;
    assert.equal(saved.responseId, 'surviving-response');
    assert.equal(saved.status, 'running');
    const resumed = new HostedEmployees(f.store, async () => credentials);
    assert.equal(resumed.peek(s.id).status, 'running');
  } finally {
    await f.close();
  }
});

test('failed first dispatch remains owner-discoverable on disk and retries with its original request identity', async () => {
  const f = await fixture();
  const keys: string[] = [];
  let reopened: SnapshotStore | undefined;
  globalThis.fetch = async (_url, init) => {
    keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
    if (keys.length === 1) throw new TypeError('initial dispatch interrupted');
    return response('recovered-first-response', [message('Recovered from the saved initial request')]);
  };
  try {
    const first = new HostedEmployees(f.store, async () => credentials);
    assert.equal(first.sessionFor(f.employee.id), null);
    await assert.rejects(
      () => first.start(f.employee, 'Preserve my initial request', f.state),
      /initial dispatch interrupted/,
    );
    const pending = first.sessionFor(f.employee.id);
    assert.ok(pending);
    assert.equal(pending.status, 'queued');
    assert.equal(f.employee.sessionId, undefined);
    assert.equal(pending.output, undefined);
    reopened = await SnapshotStore.open(path.dirname(f.store.filePath));
    const resumed = new HostedEmployees(reopened, async () => credentials);
    assert.equal(resumed.sessionFor(f.employee.id)?.id, pending.id);
    const completed = await resumed.get(pending.id);
    assert.equal(completed.status, 'completed');
    assert.equal(keys[0], keys[1]);
    assert.ok(keys[0]);
    await reopened.put('employee-session:wrong-owner', pending.id);
    await reopened.put('employee-session:missing-session', 'does-not-exist');
    assert.equal(resumed.sessionFor('wrong-owner'), null);
    assert.equal(resumed.sessionFor('missing-session'), null);
    assert.equal(resumed.sessionFor(f.employee.id)?.id, pending.id);
  } finally {
    reopened?.close();
    await f.close();
  }
});
