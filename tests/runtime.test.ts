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
    assert.equal(first.work.length, 1);
    assert.equal(second.work.length, 1);

    const evaluated = await office.command({ type: 'source.evaluate', id: 'src-discord-bug' });
    assert.equal(evaluated.work.length, 1);
    assert.ok(['attached', 'work'].includes(evaluated.sources.find((item) => item.id === 'src-discord-bug')?.disposition || ''));
  } finally {
    await office.close();
  }
});

test('cancels running demo work and retries the same durable work item', async () => {
  const office = await runtime();
  try {
    const started = await office.command({ type: 'scenario.run', scenario: 'report' });
    const id = started.work[0].id;
    const cancelled = await office.command({ type: 'work.cancel', id });
    assert.equal(cancelled.work[0].status, 'cancelled');
    const retried = await office.command({ type: 'work.retry', id });
    assert.ok(['queued', 'running'].includes(retried.work[0].status));
    assert.equal(retried.work.length, 1);
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
    const id = saved.routines[0].id;
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
    assert.equal(reset.work.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.equal(office.snapshot().work.length, 0);
  } finally {
    await office.close();
  }
});

test('dinner demo writes a labeled artifact and linked local calendar event', async () => {
  const office = await runtime();
  try {
    await office.command({ type: 'demo.speed', speed: 4 });
    await office.command({ type: 'scenario.run', scenario: 'dinner' });
    await waitFor(() => office.snapshot().work[0]?.status === 'completed', 4_000);
    const snapshot = office.snapshot();
    const artifact = snapshot.artifacts.find((item) => item.workId === snapshot.work[0].id)!;
    assert.equal(artifact.kind, 'calendar');
    assert.equal(snapshot.calendar[0].simulated, true);
    assert.deepEqual(snapshot.calendar[0].sourceIds, snapshot.work[0].sourceIds);
    assert.match(await readFile(office.getArtifactPath(artifact.id)!, 'utf8'), /SIMULATED DEMO/);
  } finally {
    await office.close();
  }
});

test('Codex transport keeps completion notifications that beat turn/start response', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'little-office-codex-test-'));
  const executable = path.join(directory, 'mock-codex');
  await writeFile(executable, `#!/usr/bin/env node
if (process.argv.includes('mcp')) { process.stdout.write('[]'); process.exit(0); }
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'mock', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux' } });
  if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-1' } } });
  if (message.method === 'turn/start') {
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
    const result = await client.runTurn({ cwd: directory, model: 'mock', prompt: 'test' });
    assert.equal(result.status, 'completed');
    assert.equal(result.message, 'early result');
  } finally {
    await client.close();
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
