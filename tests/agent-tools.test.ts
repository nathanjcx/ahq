import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EmployeeTools,
  type AgentToolContext,
  type AgentMemory,
  type OfficeMessage,
  type AgentArtifact,
} from '../desktop/agent-tools';
import { defaultAgentConfig } from '../shared/agent-config';
import { SnapshotStore } from '../runtime/store';
import { initialState } from '../src/lib/store';
import { OFFICE_TOOL_ATLAS, officeAnalogyForTool } from '../shared/office-tool-atlas';

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ahq-agent-tools-'));
  let store = await SnapshotStore.open(dir),
    clock = Date.parse('2026-09-10T12:00:00.000Z');
  const state = initialState();
  for (const employee of state.employees) {
    employee.agent = defaultAgentConfig();
    employee.agent.memory.scopes = ['session', 'employee', 'workspace'];
    employee.agent.memory.write = 'automatic';
    employee.agent.autonomy.toolApproval = 'allow';
  }
  let tools = new EmployeeTools(
    store,
    async () => state,
    () => clock,
  );
  let calls = 0;
  const a = state.employees[0].id,
    b = state.employees[1].id,
    c = state.employees[2].id;
  function context(employeeId = a, sessionId = `session-${employeeId}`): AgentToolContext {
    return {
      employeeId,
      sessionId,
      config: structuredClone(state.employees.find((employee) => employee.id === employeeId)!.agent!),
      files: [],
      turn: 1,
      depth: 0,
      callId: `call-${++calls}`,
    };
  }
  return {
    dir,
    state,
    a,
    b,
    c,
    context,
    get tools() {
      return tools;
    },
    get store() {
      return store;
    },
    advance(milliseconds: number) {
      clock += milliseconds;
    },
    async reopen() {
      store.close();
      store = await SnapshotStore.open(dir);
      tools = new EmployeeTools(
        store,
        async () => state,
        () => clock,
      );
    },
    async close() {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('every granted local tool has one concrete office object and auditable evidence mapping', async () => {
  const f = await fixture();
  try {
    const context = f.context();
    context.config.tools.workspaceRead = true;
    const definitions = f.tools.definitions(context);
    assert.equal(definitions.length, 12);
    assert.equal(new Set(OFFICE_TOOL_ATLAS.map((entry) => entry.id)).size, OFFICE_TOOL_ATLAS.length);
    for (const definition of definitions) {
      const analogy = officeAnalogyForTool(String(definition.name));
      assert.ok(analogy, `Missing office object for ${definition.name}`);
      assert.ok(analogy.object && analogy.action && analogy.evidence && analogy.station);
    }
    assert.equal(officeAnalogyForTool('mcp_integration_tracker_list_tasks')?.station, 'connections');
    assert.equal(officeAnalogyForTool('unknown_not_granted'), undefined);
  } finally {
    await f.close();
  }
});

test('typed memory is scoped by employee, session and explicit workspace sharing and survives reopen', async () => {
  const f = await fixture();
  try {
    await f.tools.addMemory(f.a, { kind: 'semantic', scope: 'employee', content: 'Alpha private fact' });
    await f.tools.addMemory(f.a, {
      kind: 'working',
      scope: 'session',
      sessionId: 'session-original',
      content: 'Alpha session fact',
    });
    await f.tools.addMemory(f.a, {
      kind: 'procedural',
      scope: 'workspace',
      content: 'Shared review procedure',
    });
    await f.tools.addMemory(f.b, {
      kind: 'preference',
      scope: 'employee',
      content: 'Beta private preference',
    });
    await f.reopen();
    const read = async (employee: string, session: string) =>
      (
        (await f.tools.execute('memory_search', {}, f.context(employee, session))) as {
          memories: AgentMemory[];
        }
      ).memories.map((memory) => memory.content);
    assert.deepEqual(
      (await read(f.a, 'session-original')).sort(),
      ['Alpha private fact', 'Alpha session fact', 'Shared review procedure'].sort(),
    );
    assert.deepEqual(
      (await read(f.a, 'session-other')).sort(),
      ['Alpha private fact', 'Shared review procedure'].sort(),
    );
    assert.deepEqual(
      (await read(f.b, 'session-beta')).sort(),
      ['Beta private preference', 'Shared review procedure'].sort(),
    );
    assert.equal(f.store.get('workspace'), undefined);
    assert.equal(f.store.history().length, 0);
  } finally {
    await f.close();
  }
});

test('memory proposals require explicit user approval and preserve employee provenance through user edits', async () => {
  const f = await fixture();
  try {
    f.state.employees[0].agent!.memory.write = 'propose';
    const context = f.context();
    const proposed = (await f.tools.execute(
      'memory_remember',
      { kind: 'episodic', scope: 'employee', content: 'The review found a missing assumption.' },
      context,
    )) as AgentMemory;
    assert.equal(proposed.status, 'proposed');
    assert.equal(proposed.provenance.sessionId, context.sessionId);
    assert.deepEqual(
      ((await f.tools.execute('memory_search', {}, f.context())) as { memories: AgentMemory[] }).memories,
      [],
    );
    await assert.rejects(() => f.tools.approveMemory(f.b, proposed.id), /owned by another/);
    const approved = await f.tools.approveMemory(f.a, proposed.id);
    assert.equal(approved.status, 'active');
    assert.ok(approved.approvedAt);
    const edited = await f.tools.updateMemory(f.a, proposed.id, {
      content: 'The user corrected the assumption.',
    });
    assert.equal(edited.provenance.callId, context.callId);
    assert.equal(edited.editedBy, 'user');
    assert.equal((await f.tools.listMemory(f.a))[0].content, 'The user corrected the assumption.');
    await f.tools.forgetMemory(f.a, proposed.id);
    assert.deepEqual(await f.tools.listMemory(f.a), []);
  } finally {
    await f.close();
  }
});

test('every memory kind is retained as typed data, and disabled kinds, scopes and writes are rejected at execution', async () => {
  const f = await fixture();
  try {
    for (const kind of ['working', 'episodic', 'semantic', 'procedural', 'preference'] as const) {
      const memory = (await f.tools.execute(
        'memory_remember',
        { kind, scope: 'employee', content: `${kind} evidence` },
        f.context(),
      )) as AgentMemory;
      assert.equal(memory.kind, kind);
    }
    const stale = f.context();
    f.state.employees[0].agent!.memory.kinds = ['working'];
    f.state.employees[0].agent!.memory.scopes = ['employee'];
    await assert.rejects(
      () =>
        f.tools.execute('memory_remember', { kind: 'semantic', scope: 'employee', content: 'denied' }, stale),
      /type is disabled/,
    );
    await assert.rejects(
      () =>
        f.tools.execute(
          'memory_remember',
          { kind: 'working', scope: 'workspace', content: 'denied' },
          f.context(),
        ),
      /scope is disabled/,
    );
    f.state.employees[0].agent!.memory.write = 'off';
    await assert.rejects(
      () =>
        f.tools.execute(
          'memory_remember',
          { kind: 'working', scope: 'employee', content: 'denied' },
          f.context(),
        ),
      /disabled/,
    );
    f.state.employees[0].agent!.memory.enabled = false;
    await assert.rejects(() => f.tools.execute('memory_search', {}, f.context()), /disabled/);
    assert.deepEqual(((await f.tools.context(f.context())) as { memories: AgentMemory[] }).memories, []);
  } finally {
    await f.close();
  }
});

test('memory retention, reduced limits and serialized context size are enforced without exposing expired values', async () => {
  const f = await fixture();
  try {
    const config = f.state.employees[0].agent!;
    config.memory.retentionDays = 1;
    config.memory.maxEntries = 2;
    config.memory.maxContextChars = 1000;
    for (let index = 0; index < 3; index++) {
      await f.tools.addMemory(f.a, {
        kind: 'semantic',
        scope: 'employee',
        content: `Entry ${index} ${'quoted " fact\n'.repeat(200)}`,
      });
      f.advance(1000);
    }
    const retained = await f.tools.listMemory(f.a);
    assert.equal(retained.length, 2);
    assert.ok(retained.every((memory) => !memory.content.startsWith('Entry 0')));
    const memories = (
      (await f.tools.execute('memory_search', {}, f.context())) as { memories: AgentMemory[] }
    ).memories;
    assert.ok(JSON.stringify(memories).length <= config.memory.maxContextChars);
    config.memory.maxEntries = 1;
    assert.equal((await f.tools.listMemory(f.a)).length, 1);
    f.advance(86_400_001);
    assert.deepEqual(await f.tools.listMemory(f.a), []);
    await f.reopen();
    assert.deepEqual(await f.tools.listMemory(f.a), []);
  } finally {
    await f.close();
  }
});

test('mutating call receipts are persisted atomically and replay without duplicate memory, messages or artifacts', async () => {
  const f = await fixture();
  try {
    const context = f.context();
    const args = { employeeId: f.b, text: 'Review the actual result.' };
    const [first, duplicate] = await Promise.all([
      f.tools.execute('office_send_message', args, context),
      f.tools.execute('office_send_message', args, context),
    ]);
    assert.deepEqual(duplicate, first);
    await f.reopen();
    assert.deepEqual(await f.tools.execute('office_send_message', args, context), first);
    assert.equal((await f.tools.pendingMessages(f.b)).length, 1);
    await assert.rejects(
      () => f.tools.execute('office_send_message', { ...args, text: 'Different effect' }, context),
      /different action/,
    );
    for (const [name, fields] of [
      ['memory_remember', { kind: 'semantic', scope: 'employee', content: 'One fact' }],
      ['artifact_write', { title: 'Result', content: 'One result' }],
    ] as const) {
      const call = f.context();
      assert.deepEqual(await f.tools.execute(name, fields, call), await f.tools.execute(name, fields, call));
    }
    assert.equal((await f.tools.listMemory(f.a)).length, 1);
    assert.equal((await f.tools.listArtifacts(f.a)).length, 1);
  } finally {
    await f.close();
  }
});

test('message queue, delivery and acknowledgment are separate, persisted and visible only to participants', async () => {
  const f = await fixture();
  try {
    const message = (await f.tools.execute(
      'office_send_message',
      { employeeId: f.b, text: 'Inspect the source before replying.' },
      f.context(),
    )) as OfficeMessage;
    assert.equal(message.status, 'queued');
    assert.equal(message.depth, 1);
    assert.equal((await f.tools.pendingMessages(f.b)).length, 1);
    assert.deepEqual(await f.tools.listMessages(f.c), []);
    const wrongInbox = (await f.tools.execute('office_read_inbox', {}, f.context(f.c))) as {
      messages: OfficeMessage[];
    };
    assert.deepEqual(wrongInbox.messages, []);
    await assert.rejects(
      () => f.tools.execute('office_acknowledge_message', { id: message.id }, f.context(f.b)),
      /Read the message/,
    );
    await assert.rejects(() => f.tools.deliverMessage(message.id, f.a, 'wrong-session'), /not found/);
    const inbox = (await f.tools.execute('office_read_inbox', {}, f.context(f.b))) as {
      messages: OfficeMessage[];
    };
    assert.equal(inbox.messages[0].status, 'delivered');
    assert.equal(inbox.messages[0].acknowledgedAt, undefined);
    assert.deepEqual(await f.tools.pendingMessages(f.b), []);
    await assert.rejects(
      () => f.tools.execute('office_acknowledge_message', { id: message.id }, f.context(f.c)),
      /not found/,
    );
    const acknowledged = (await f.tools.execute(
      'office_acknowledge_message',
      { id: message.id },
      f.context(f.b),
    )) as OfficeMessage;
    assert.equal(acknowledged.status, 'acknowledged');
    await f.reopen();
    assert.equal((await f.tools.listMessages(f.a))[0].status, 'acknowledged');
    assert.deepEqual(
      (
        (await f.tools.execute('office_read_inbox', { unreadOnly: true }, f.context(f.b))) as {
          messages: OfficeMessage[];
        }
      ).messages,
      [],
    );
  } finally {
    await f.close();
  }
});

test('teammate allowlists, recipient preferences and handoff count/depth constrain real message dispatch', async () => {
  const f = await fixture();
  try {
    const config = f.state.employees[0].agent!;
    config.communication.teammateIds = [f.b];
    const employees = (await f.tools.execute('office_list_employees', {}, f.context())) as {
      employees: { id: string }[];
    };
    assert.deepEqual(
      employees.employees.map((employee) => employee.id),
      [f.b],
    );
    await assert.rejects(
      () => f.tools.execute('office_send_message', { employeeId: f.c, text: 'blocked' }, f.context()),
      /teammate is disabled/,
    );
    f.state.employees[1].agent!.communication.receiveMessages = false;
    await assert.rejects(
      () => f.tools.execute('office_send_message', { employeeId: f.b, text: 'blocked' }, f.context()),
      /not accepting/,
    );
    f.state.employees[1].agent!.communication.receiveMessages = true;
    config.communication.maxHandoffs = 1;
    await f.tools.execute('office_send_message', { employeeId: f.b, text: 'first' }, f.context());
    await assert.rejects(
      () => f.tools.execute('office_send_message', { employeeId: f.b, text: 'second' }, f.context()),
      /maximum number/,
    );
    await assert.rejects(
      () =>
        f.tools.execute(
          'office_send_message',
          { employeeId: f.b, text: 'deep' },
          { ...f.context(f.a, 'different-session'), depth: 1 },
        ),
      /depth/,
    );
    assert.equal((await f.tools.pendingMessages()).length, 1);
  } finally {
    await f.close();
  }
});

test('workspace tools read only attached snapshots, reject ambiguous and unsafe paths, and honor revocation', async () => {
  const f = await fixture();
  try {
    const context = f.context();
    context.files = [
      { folder: 'one', path: 'report.md', content: 'The measured total is 137.' },
      { folder: 'two', path: 'report.md', content: 'Other selected report.' },
      { folder: 'one', path: '../outside.md', content: 'Outside content must never appear.' },
    ];
    const search = (await f.tools.execute('workspace_search', { query: 'measured' }, context)) as {
      matches: { path: string; excerpt: string }[];
    };
    assert.equal(search.matches[0].path, 'report.md');
    assert.match(search.matches[0].excerpt, /137/);
    const read = (await f.tools.execute(
      'workspace_read',
      { folder: 'one', path: 'report.md', offset: 4, limit: 8 },
      context,
    )) as { content: string; truncated: boolean };
    assert.equal(read.content, 'measured');
    assert.equal(read.truncated, true);
    await assert.rejects(
      () => f.tools.execute('workspace_read', { path: 'report.md' }, context),
      /ambiguous/,
    );
    await assert.rejects(
      () => f.tools.execute('workspace_read', { path: '../outside.md' }, context),
      /selected snapshot/,
    );
    await assert.rejects(
      () => f.tools.execute('workspace_read', { path: '/etc/passwd' }, context),
      /selected snapshot/,
    );
    await assert.rejects(
      () => f.tools.execute('workspace_read', { path: 'not-selected.md' }, context),
      /not selected/,
    );
    f.state.employees[0].agent!.tools.workspaceRead = false;
    await assert.rejects(
      () => f.tools.execute('workspace_search', { query: 'measured' }, context),
      /disabled/,
    );
  } finally {
    await f.close();
  }
});

test('artifacts are actual durable content owned by their employee and cannot be arbitrary-path writes', async () => {
  const f = await fixture();
  try {
    const context = f.context();
    const artifact = (await f.tools.execute(
      'artifact_write',
      { title: 'Computed output', content: '{"total":137}', mediaType: 'application/json' },
      context,
    )) as AgentArtifact;
    await f.reopen();
    assert.deepEqual(JSON.parse((await f.tools.readArtifact(f.a, artifact.id)).content), { total: 137 });
    assert.deepEqual(await f.tools.listArtifacts(f.b), []);
    await assert.rejects(
      () => f.tools.execute('artifact_read', { id: artifact.id }, f.context(f.b)),
      /owned by another/,
    );
    await assert.rejects(() =>
      f.tools.execute(
        'artifact_write',
        { path: '/tmp/unsolicited', title: 'Bad path', content: 'bad' },
        f.context(),
      ),
    );
    await assert.rejects(() =>
      f.tools.execute(
        'artifact_write',
        { title: 'Bad JSON', content: 'invalid JSON', mediaType: 'application/json' },
        f.context(),
      ),
    );
    assert.equal((await f.tools.listArtifacts(f.a)).length, 1);
  } finally {
    await f.close();
  }
});

test('tool approvals, absent call IDs, spoofed arguments and unknown tools fail without creating effects', async () => {
  const f = await fixture();
  try {
    f.state.employees[0].agent!.autonomy.toolApproval = 'ask';
    const context = f.context();
    assert.equal(f.tools.requiresApproval('artifact_write', context), true);
    assert.equal(f.tools.requiresApproval('workspace_read', context), false);
    await assert.rejects(
      () => f.tools.execute('artifact_write', { title: 'No approval', content: 'no' }, context),
      /approval/,
    );
    await f.tools.execute(
      'artifact_write',
      { title: 'Approved', content: 'yes' },
      { ...context, approved: true },
    );
    await assert.rejects(() =>
      f.tools.execute(
        'office_send_message',
        { employeeId: f.b, text: 'x', fromEmployeeId: f.c },
        { ...f.context(), approved: true },
      ),
    );
    await assert.rejects(
      () =>
        f.tools.execute(
          'memory_remember',
          { kind: 'semantic', scope: 'employee', content: 'x' },
          { ...f.context(), approved: true, callId: undefined },
        ),
      /stable tool call ID/,
    );
    await assert.rejects(
      () => f.tools.execute('shell_execute', { command: 'true' }, f.context()),
      /disabled/,
    );
    assert.equal((await f.tools.listArtifacts(f.a)).length, 1);
    assert.deepEqual(await f.tools.listMessages(f.a), []);
  } finally {
    await f.close();
  }
});

test('cancellation, session ownership and cross-employee memory changes are rejected before effects', async () => {
  const f = await fixture();
  try {
    const memory = await f.tools.addMemory(f.a, {
      kind: 'semantic',
      scope: 'workspace',
      content: 'Shared but owned by Alpha.',
    });
    await assert.rejects(
      () => f.tools.updateMemory(f.b, memory.id, { content: 'overwrite' }),
      /owned by another/,
    );
    await assert.rejects(
      () => f.tools.execute('memory_forget', { id: memory.id }, f.context(f.b)),
      /owned by another/,
    );
    await f.store.put('session:owned-session', { employeeId: f.b });
    await assert.rejects(
      () =>
        f.tools.execute(
          'office_send_message',
          { employeeId: f.b, text: 'spoofed' },
          f.context(f.a, 'owned-session'),
        ),
      /belongs to another/,
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(() =>
      f.tools.execute(
        'artifact_write',
        { title: 'Cancelled', content: 'no' },
        { ...f.context(), signal: abort.signal },
      ),
    );
    assert.deepEqual(await f.tools.listArtifacts(f.a), []);
    assert.equal((await f.tools.listMemory(f.a)).length, 1);
  } finally {
    await f.close();
  }
});

test('forgotten and expired memories are also removed from local mutation receipts while deduplication survives', async () => {
  const f = await fixture();
  try {
    const context = f.context();
    const args = { kind: 'semantic', scope: 'employee', content: 'Retired-memory-unique-marker' };
    const memory = (await f.tools.execute('memory_remember', args, context)) as AgentMemory;
    await f.tools.updateMemory(f.a, memory.id, { content: 'Corrected-memory-unique-marker' });
    assert.ok(!JSON.stringify(f.store.get('agent-tools:v1')).includes(args.content));
    await f.tools.forgetMemory(f.a, memory.id);
    assert.ok(!JSON.stringify(f.store.get('agent-tools:v1')).includes(args.content));
    await f.reopen();
    assert.deepEqual(await f.tools.execute('memory_remember', args, context), {
      id: memory.id,
      forgotten: true,
    });
    assert.deepEqual(await f.tools.listMemory(f.a), []);
    f.state.employees[0].agent!.memory.retentionDays = 1;
    const expiringContext = f.context();
    const expiringArgs = { ...args, content: 'Expired-memory-unique-marker' };
    const expiring = (await f.tools.execute('memory_remember', expiringArgs, expiringContext)) as AgentMemory;
    f.advance(86_400_001);
    assert.deepEqual(await f.tools.execute('memory_remember', expiringArgs, expiringContext), {
      id: expiring.id,
      forgotten: true,
    });
    assert.ok(!JSON.stringify(f.store.get('agent-tools:v1')).includes(expiringArgs.content));
  } finally {
    await f.close();
  }
});

test('proposal mode requires approval before deleting memory even when general tool approval is allowed', async () => {
  const f = await fixture();
  try {
    f.state.employees[0].agent!.memory.write = 'propose';
    const memory = await f.tools.addMemory(f.a, {
      kind: 'semantic',
      scope: 'employee',
      content: 'Keep until reviewed.',
    });
    const context = f.context();
    assert.equal(f.tools.requiresApproval('memory_forget', context), true);
    await assert.rejects(() => f.tools.execute('memory_forget', { id: memory.id }, context), /approval/);
    assert.equal((await f.tools.listMemory(f.a)).length, 1);
    await f.tools.execute('memory_forget', { id: memory.id }, { ...context, approved: true });
    assert.deepEqual(await f.tools.listMemory(f.a), []);
  } finally {
    await f.close();
  }
});

test('handoff counts reset for a new assignment while preserving the employee session', async () => {
  const f = await fixture();
  try {
    f.state.employees[0].agent!.communication.maxHandoffs = 1;
    const firstRun = { ...f.context(), runId: 'assignment-one' };
    const secondRun = { ...f.context(), runId: 'assignment-two' };
    assert.equal(firstRun.sessionId, secondRun.sessionId);
    await f.tools.execute(
      'office_send_message',
      { employeeId: f.b, text: 'First assignment result' },
      firstRun,
    );
    await assert.rejects(
      () =>
        f.tools.execute(
          'office_send_message',
          { employeeId: f.b, text: 'Over limit' },
          { ...f.context(), runId: 'assignment-one' },
        ),
      /maximum number/,
    );
    await f.tools.execute(
      'office_send_message',
      { employeeId: f.b, text: 'Second assignment result' },
      secondRun,
    );
    assert.equal((await f.tools.pendingMessages(f.b)).length, 2);
  } finally {
    await f.close();
  }
});
