import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentOffice } from '../desktop/agent-office';
import { EmployeeTools, type AgentToolContext } from '../desktop/agent-tools';
import type { HostedEmployees } from '../desktop/hosted';
import type { CloudSession } from '../shared/types';
import { defaultAgentConfig } from '../shared/agent-config';
import { initialState } from '../src/lib/store';
import { SnapshotStore } from '../runtime/store';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ahq-agent-office-'));
  const store = await SnapshotStore.open(dir);
  let state = initialState(), nextId = 0;
  for (const employee of state.employees) {
    employee.agent = defaultAgentConfig();
    employee.agent.autonomy.toolApproval = 'allow';
  }
  const sessions = new Map<string, CloudSession>();
  const employeeSessions = new Map<string, string>();
  const calls: { kind: 'start' | 'continue'; employeeId: string; sessionId: string; text: string; depth: number }[] = [];
  const controls = { gate: undefined as ReturnType<typeof deferred> | undefined, failEmployee: '', persistBeforeFailure: false, status: 'completed' as CloudSession['status'] };
  const hosted: Pick<HostedEmployees, 'owns' | 'peek' | 'start' | 'continue' | 'sessionFor'> = {
    owns: (sessionId) => sessions.has(sessionId),
    peek: (sessionId) => sessions.get(sessionId)!,
    sessionFor: (employeeId) => sessions.get(employeeSessions.get(employeeId) ?? '') ?? null,
    async start(employee, assignment, _state, _files, options) {
      const sessionId = `mock-session-${++nextId}`;
      calls.push({ kind: 'start', employeeId: employee.id, sessionId, text: assignment, depth: options?.depth ?? 0 });
      if (controls.persistBeforeFailure) {
        sessions.set(sessionId, { id: sessionId, status: 'queued', activity: 'Scripted request saved before dispatch', location: 'desk', events: [] });
        employeeSessions.set(employee.id, sessionId);
      }
      await controls.gate?.promise;
      if (controls.failEmployee === employee.id) throw new Error('Scripted provider unavailable');
      const session: CloudSession = { id: sessionId, status: controls.status, activity: 'Scripted orchestration fixture', location: 'desk', events: [] };
      sessions.set(sessionId, session);
      employeeSessions.set(employee.id, sessionId);
      return session;
    },
    async continue(sessionId, input, _queueWhileRunning, override) {
      calls.push({ kind: 'continue', employeeId: override!.employee.id, sessionId, text: String(input), depth: override?.depth ?? 0 });
      await controls.gate?.promise;
      if (controls.failEmployee === override!.employee.id) throw new Error('Scripted provider unavailable');
      const session = { ...sessions.get(sessionId)!, status: controls.status };
      sessions.set(sessionId, session);
      return session;
    },
  };
  const tools = new EmployeeTools(store, async () => state);
  const office = new AgentOffice(async () => state, async (change) => { state = change(state); }, async (employeeId, session) => {
    state = { ...state, employees: state.employees.map((employee) => employee.id === employeeId ? { ...employee, sessionId: session.id } : employee) };
  }, hosted, tools);
  let callId = 0;
  async function send(from: string, to: string, text: string, depth = 0) {
    const context: AgentToolContext = { employeeId: from, sessionId: `sender-${from}`, callId: `send-${++callId}`, turn: 1, depth, files: [], config: state.employees.find((employee) => employee.id === from)!.agent! };
    return tools.execute('office_send_message', { employeeId: to, text }, context);
  }
  function enableAuto(employeeId: string) {
    const employee = state.employees.find((item) => item.id === employeeId)!;
    employee.agent!.communication.autoRespond = true;
    employee.agent!.autonomy.initiative = 'on-message';
  }
  return { office, tools, sessions, calls, controls, send, enableAuto, get state() { return state; },
    a: state.employees[0].id, b: state.employees[1].id, c: state.employees[2].id,
    async close() { controls.gate?.resolve(); store.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test('manager broadcast invokes every enabled employee concurrently without inventing acknowledgments', async () => {
  const f = await fixture();
  try {
    f.state.employees[0].agent!.communication.receiveAnnouncements = false;
    f.controls.gate = deferred();
    const broadcast = f.office.message('announce', 'Review the selected evidence.');
    await tick();
    assert.equal(f.calls.length, f.state.employees.length - 1);
    assert.equal(new Set(f.calls.map((call) => call.sessionId)).size, f.calls.length);
    assert.equal(f.state.messages.at(-1)?.acknowledgmentIds, undefined);
    f.controls.gate.resolve();
    const results = await broadcast;
    assert.ok(results.every((result) => result.session && !result.error));
    assert.ok(results.every((result) => result.employeeId !== f.a));
  } finally { await f.close(); }
});

test('rapid messages to one employee serialize and continue the same persisted session', async () => {
  const f = await fixture();
  try {
    f.controls.gate = deferred();
    const first = f.office.invoke(f.a, 'First instruction');
    const second = f.office.invoke(f.a, 'Follow-up instruction');
    await tick();
    assert.equal(f.calls.length, 1);
    f.controls.gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.id, b.id);
    assert.deepEqual(f.calls.map((call) => call.kind), ['start', 'continue']);
    assert.equal(f.calls[1].text, 'Follow-up instruction');
  } finally { await f.close(); }
});

test('auto-response requires both settings and batches queued messages into one wakeup', async () => {
  const f = await fixture();
  try {
    await f.send(f.a, f.b, 'First teammate finding');
    await f.send(f.c, f.b, 'Second teammate finding');
    await f.office.deliverPending();
    assert.equal(f.calls.length, 0);
    f.state.employees[1].agent!.communication.autoRespond = true;
    await f.office.deliverPending();
    assert.equal(f.calls.length, 0);
    f.enableAuto(f.b);
    await f.office.deliverPending();
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].text, /First teammate finding/);
    assert.match(f.calls[0].text, /Second teammate finding/);
    const messages = await f.tools.listMessages(f.b);
    assert.ok(messages.every((message) => message.status === 'delivered' && !message.acknowledgedAt));
  } finally { await f.close(); }
});

test('concurrent delivery polls do not duplicate an employee wakeup', async () => {
  const f = await fixture();
  try {
    f.enableAuto(f.b);
    await f.send(f.a, f.b, 'One pending request');
    f.controls.gate = deferred();
    const first = f.office.deliverPending();
    await tick();
    const second = f.office.deliverPending();
    await tick();
    assert.equal(f.calls.length, 1);
    f.controls.gate.resolve();
    await Promise.all([first, second]);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.tools.pendingMessages(f.b)).length, 0);
  } finally { await f.close(); }
});

test('queued-message delivery rechecks recipient and sender policies before disclosing text', async () => {
  const f = await fixture();
  try {
    f.enableAuto(f.b);
    await f.send(f.a, f.b, 'Restricted queued message');
    f.state.employees[1].agent!.communication.teammateIds = [f.c];
    await f.office.deliverPending();
    assert.equal(f.calls.length, 0);
    f.state.employees[1].agent!.communication.teammateIds = [];
    f.state.employees[0].agent!.communication.sendMessages = false;
    await f.office.deliverPending();
    assert.equal(f.calls.length, 0);
    assert.equal((await f.tools.pendingMessages(f.b)).length, 1);
  } finally { await f.close(); }
});

test('handoff depth travels into the recipient session and exceeds neither recipient limits nor active-session boundaries', async () => {
  const f = await fixture();
  try {
    f.enableAuto(f.b);
    await f.send(f.a, f.b, 'Depth three request', 2);
    f.state.employees[1].agent!.communication.maxHandoffs = 2;
    await f.office.deliverPending();
    assert.equal(f.calls.length, 0);
    f.state.employees[1].agent!.communication.maxHandoffs = 4;
    f.controls.status = 'running';
    await f.office.invoke(f.b, 'Already running');
    await f.office.deliverPending();
    assert.equal(f.calls.length, 1);
    f.sessions.get(f.calls[0].sessionId)!.status = 'completed';
    f.controls.status = 'completed';
    await f.office.deliverPending();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].depth, 3);
    await assert.rejects(() => f.office.invoke(f.b, 'Too deep', 5), /handoff limit/);
  } finally { await f.close(); }
});

test('a failed employee delivery stays queued while another recipient proceeds', async () => {
  const f = await fixture();
  try {
    f.enableAuto(f.b); f.enableAuto(f.c);
    await f.send(f.a, f.b, 'Provider failure expected');
    await f.send(f.a, f.c, 'Independent delivery');
    f.controls.failEmployee = f.b;
    await f.office.deliverPending();
    assert.equal((await f.tools.pendingMessages(f.b)).length, 1);
    assert.equal((await f.tools.pendingMessages(f.c)).length, 0);
    assert.equal((await f.tools.listMessages(f.c))[0].status, 'delivered');
  } finally { await f.close(); }
});

test('failed or cancelled provider results never become message delivery receipts', async () => {
  const f = await fixture();
  try {
    f.enableAuto(f.b);
    await f.send(f.a, f.b, 'Await a real accepted response');
    for (const status of ['failed', 'cancelled'] as const) {
      f.controls.status = status;
      await f.office.deliverPending();
      assert.equal((await f.tools.pendingMessages(f.b)).length, 1);
    }
    assert.ok((await f.tools.listMessages(f.b)).every((message) => !message.deliveredAt));
  } finally { await f.close(); }
});

test('a failed initial dispatch attaches its indexed session before returning the manager error', async () => {
  const f = await fixture();
  try {
    f.controls.persistBeforeFailure = true;
    f.controls.failEmployee = f.a;
    await assert.rejects(() => f.office.invoke(f.a, 'Initial request'), /Scripted provider unavailable/);
    const attached = f.state.employees.find((employee) => employee.id === f.a)!.sessionId;
    assert.equal(attached, f.calls[0].sessionId);
    assert.equal(f.sessions.get(attached!)!.status, 'queued');
    f.controls.failEmployee = '';
    await f.office.invoke(f.a, 'Recover the pending request');
    assert.deepEqual(f.calls.map((call) => call.kind), ['start', 'continue']);
    assert.equal(f.calls[1].sessionId, attached);
  } finally { await f.close(); }
});
