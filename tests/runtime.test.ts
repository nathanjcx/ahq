import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntime, type OfficeRuntime } from '../runtime/engine';
import { CodexAppServer } from '../runtime/codex';

process.env.CODEX_BIN = path.join(os.tmpdir(), 'little-office-codex-not-installed');

async function runtime(): Promise<OfficeRuntime> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'little-office-test-'));
  return createRuntime({ dataDir, onSnapshot: () => undefined });
}

test('deduplicates active scenarios and correlated source items', async () => {
  const office = await runtime();
  try {
    const first = await office.command({ type: 'scenario.run', scenario: 'bug' });
    const second = await office.command({ type: 'scenario.run', scenario: 'bug' });
    assert.equal(first.work.filter((work) => work.scenario === 'bug').length, 1);
    assert.equal(second.work.filter((work) => work.scenario === 'bug').length, 1);

    const evaluated = await office.command({ type: 'source.evaluate', id: 'src-discord-bug' });
    assert.equal(evaluated.work.filter((work) => work.scenario === 'bug').length, 1);
    assert.ok(['attached', 'work'].includes(evaluated.sources.find((item) => item.id === 'src-discord-bug')?.disposition || ''));
  } finally {
    await office.close();
  }
});

test('cancels running demo work and retries the same durable work item', async () => {
  const office = await runtime();
  try {
    const started = await office.command({ type: 'scenario.run', scenario: 'report' });
    const id = started.work.at(-1)!.id;
    const cancelled = await office.command({ type: 'work.cancel', id });
    assert.equal(cancelled.work.at(-1)!.status, 'cancelled');
    const retried = await office.command({ type: 'work.retry', id });
    assert.ok(['queued', 'running'].includes(retried.work.at(-1)!.status));
    assert.equal(retried.work.length, 2);
  } finally {
    await office.close();
  }
});

test('runs a saved routine once and updates agent persistence', async () => {
  const office = await runtime();
  try {
    const saved = await office.command({
      type: 'routine.save',
      routine: {
        agentId: 'agent-maya', name: 'Morning decision memo', instructions: 'Write a report about open decisions.',
        enabled: true, schedule: 'daily', intervalMinutes: 60, dailyTime: '09:00', notes: 'For the morning review',
      },
    });
    const id = saved.routines.at(-1)!.id;
    assert.equal(saved.agents.find((agent) => agent.id === 'agent-maya')?.persistent, true);
    await office.command({ type: 'routine.run', id });
    const duplicate = await office.command({ type: 'routine.run', id });
    assert.equal(duplicate.work.filter((work) => work.routineId === id).length, 1);
    const workId = duplicate.work.find((work) => work.routineId === id)!.id;
    await office.command({ type: 'work.cancel', id: workId });
    const deleted = await office.command({ type: 'routine.delete', id });
    assert.equal(deleted.agents.find((agent) => agent.id === 'agent-maya')?.persistent, false);
  } finally {
    await office.close();
  }
});

test('reset is monotonic and stale demo jobs cannot modify replacement state', async () => {
  const office = await runtime();
  try {
    await office.command({ type: 'scenario.run', scenario: 'bug' });
    const before = office.snapshot().revision;
    const reset = await office.command({ type: 'demo.reset' });
    assert.ok(reset.revision > before);
    assert.equal(reset.work.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.equal(office.snapshot().work.length, 1);
  } finally {
    await office.close();
  }
});

test('dinner demo writes a labeled artifact and linked local calendar event', async () => {
  const office = await runtime();
  try {
    await office.command({ type: 'demo.speed', speed: 4 });
    await office.command({ type: 'scenario.run', scenario: 'dinner' });
    await waitFor(() => office.snapshot().work.at(-1)?.status === 'completed', 4_000);
    const snapshot = office.snapshot();
    const artifact = snapshot.artifacts.find((item) => item.workId === snapshot.work.at(-1)!.id)!;
    assert.equal(artifact.kind, 'calendar');
    assert.equal(snapshot.calendar.at(-1)!.simulated, true);
    assert.deepEqual(snapshot.calendar.at(-1)!.sourceIds, snapshot.work.at(-1)!.sourceIds);
    assert.match(await readFile(office.getArtifactPath(artifact.id)!, 'utf8'), /SIMULATED DEMO/);
  } finally {
    await office.close();
  }
});

test('Codex transport keeps completion notifications that beat turn/start response', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'little-office-codex-test-'));
  const executable = path.join(directory, 'mock-codex');
  await writeFile(executable, `#!/usr/bin/env node
if (process.argv.includes('mcp')) { process.stdout.write('[{"name":"external-server"}]'); process.exit(0); }
if (!process.argv.includes('mcp_servers={"external-server"={enabled=false}}')) process.exit(9);
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'mock', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux' } });
  if (message.method === 'thread/start' && Object.hasOwn(message.params, 'model')) throw new Error('Model should inherit settings');
  if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-1' } } });
  if (message.method === 'turn/start') {
    if (Object.hasOwn(message.params, 'model') || message.params.sandboxPolicy.networkAccess !== false) throw new Error('Unsafe turn settings');
    const turn = { id: 'turn-1', status: 'completed', error: null, items: [{ type: 'agentMessage', text: 'early result' }] };
    send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: turn.items[0] } });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn } });
    send({ id: message.id, result: { turn: { id: 'turn-1' } } });
  }
});
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = executable;
  const client = new CodexAppServer();
  try {
    await client.start();
    const result = await client.runTurn({ cwd: directory, model: '', prompt: 'test' });
    assert.equal(result.status, 'completed');
    assert.equal(result.message, 'early result');
  } finally {
    await client.close();
    process.env.CODEX_BIN = previous;
  }
});

test('seed references resolve, snapshots do not write, and routine edits preserve history', async () => {
  const office = await runtime();
  try {
    const initial = office.snapshot();
    assert.ok(initial.artifacts.every((artifact) => initial.work.some((work) => work.id === artifact.workId)));
    assert.ok(initial.routines.length > 0 && initial.calendar.length > 0);
    const read = await office.command({ type: 'snapshot' });
    assert.equal(read.revision, initial.revision);
    const routine = read.routines[0];
    await office.command({ type: 'routine.run', id: routine.id });
    const lastRunAt = office.snapshot().routines[0].lastRunAt;
    const edited = await office.command({ type: 'routine.save', routine: {
      id: routine.id, agentId: routine.agentId, name: routine.name, instructions: routine.instructions,
      enabled: false, schedule: 'daily', intervalMinutes: 60, dailyTime: '09:00', notes: 'Keep this note',
    } });
    assert.equal(edited.routines[0].lastRunAt, lastRunAt);
    assert.equal(edited.routines[0].notes, 'Keep this note');
    await assert.rejects(office.command({ type: 'unknown' } as never), /Unknown command/);
  } finally { await office.close(); }
});

test('completed sources attach without rerunning and repeated dinner actions retain the calendar id', async () => {
  const office = await runtime();
  try {
    await office.command({ type: 'demo.speed', speed: 4 });
    await office.command({ type: 'scenario.run', scenario: 'dinner' });
    await waitFor(() => office.snapshot().work.at(-1)?.status === 'completed', 4_000);
    const first = office.snapshot();
    const event = first.calendar.at(-1)!;
    await office.command({ type: 'source.evaluate', id: 'src-imessage-dinner' });
    assert.equal(office.snapshot().work.length, first.work.length);
    await office.command({ type: 'scenario.run', scenario: 'dinner' });
    await waitFor(() => office.snapshot().work.at(-1)?.status === 'completed', 4_000);
    assert.equal(office.snapshot().calendar.length, first.calendar.length);
    assert.equal(office.snapshot().calendar.at(-1)!.id, event.id);
  } finally { await office.close(); }
});

test('full demo ends after five scenarios and each work starts once', async () => {
  const office = await runtime();
  try {
    await office.command({ type: 'demo.speed', speed: 4 });
    await office.command({ type: 'demo.play' });
    await waitFor(() => !office.snapshot().demo.playing && office.snapshot().demo.nextIndex === 5
      && office.snapshot().work.every((work) => work.status === 'completed'), 12_000);
    const snapshot = office.snapshot();
    assert.equal(snapshot.runs.length, 5);
    assert.equal(new Set(snapshot.runs.map((run) => run.workId)).size, 5);
    assert.equal(snapshot.work.length, 6);
  } finally { await office.close(); }
});

test('early login completes and live artifacts come from files, including the applied checkout patch', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'little-office-live-test-'));
  const executable = path.join(directory, 'mock-codex');
  await writeFile(executable, `#!/usr/bin/env node
if (process.argv.includes('mcp')) { process.stdout.write('[]'); process.exit(0); }
const fs = require('node:fs');
const path = require('node:path');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
let signedIn = false;
let thread = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const reply = (result) => send({ id: message.id, result });
  if (message.method === 'initialize') reply({});
  if (message.method === 'account/read') reply({ account: signedIn ? { type: 'chatgpt', email: 'fixture@example.test', planType: 'plus' } : null });
  if (message.method === 'account/login/start') {
    signedIn = true;
    send({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } });
    reply({ type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/fixture' });
  }
  if (message.method === 'thread/start') reply({ thread: { id: 'thread-' + ++thread } });
  if (message.method === 'turn/start') {
    const cwd = message.params.cwd;
    const prompt = message.params.input[0].text;
    if (prompt.includes('report.md') && !prompt.includes('omit-artifact')) fs.writeFileSync(path.join(cwd, 'report.md'), '# Actual file report');
    if (prompt.includes('patch.md')) {
      const file = path.join(cwd, 'checkout.js');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(' + (coupon > 0 ? tax : 0)', ''));
      fs.writeFileSync(path.join(cwd, 'patch.md'), '# Actual fixture patch');
    }
    const turn = { id: 'turn-' + thread, status: 'completed', items: [{ type: 'agentMessage', text: 'Model summary is not the artifact' }] };
    send({ method: 'turn/completed', params: { threadId: message.params.threadId, turn } });
    reply({ turn: { id: turn.id } });
  }
});
`, { mode: 0o700 });
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = executable;
  const office = await createRuntime({ dataDir: path.join(directory, 'data'), onSnapshot: () => undefined });
  try {
    await office.command({ type: 'auth.login' });
    await waitFor(() => office.snapshot().auth.status === 'signed-in', 2_000);
    await office.command({ type: 'settings.update', settings: { mode: 'live', model: '' } });
    await office.command({ type: 'scenario.run', scenario: 'report' });
    await waitFor(() => office.snapshot().work.at(-1)?.status === 'completed', 2_000);
    assert.equal(office.snapshot().artifacts.at(-1)?.content, '# Actual file report');
    await office.command({ type: 'scenario.run', scenario: 'bug' });
    await waitFor(() => office.snapshot().work.at(-1)?.status === 'completed', 2_000);
    const run = office.snapshot().runs.at(-1)!;
    assert.doesNotMatch(await readFile(path.join(run.workspace!, 'checkout.js'), 'utf8'), /coupon > 0/);
    const saved = await office.command({ type: 'routine.save', routine: {
      agentId: 'agent-maya', name: 'Missing artifact', instructions: 'omit-artifact report',
      enabled: false, schedule: 'daily', intervalMinutes: 60, dailyTime: '09:00', notes: '',
    } });
    await office.command({ type: 'routine.run', id: saved.routines.at(-1)!.id });
    await waitFor(() => office.snapshot().work.at(-1)?.status === 'failed', 2_000);
    assert.match(office.snapshot().work.at(-1)!.error!, /without producing report.md/);
  } finally {
    await office.close();
    process.env.CODEX_BIN = previous;
  }
});

async function waitFor(condition: () => boolean, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for runtime state');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
