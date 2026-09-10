import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDemoServer } from '../desktop/demo-server';

test('loopback server protects triggers and supports CLI discovery', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-demo-server-'));
  let calls = 0;
  const server = await startDemoServer({
    directory,
    snapshot: async () => ({ notifications: [], sessions: [] }),
    trigger: async (input) => {
      calls++;
      return {
        id: 'notification-1',
        kind: input.kind,
        title: 'Title',
        content: 'Source',
        attachments: [],
        receivedAt: new Date().toISOString(),
        status: 'triaging',
        idempotencyKey: input.idempotencyKey,
      };
    },
  });
  try {
    const connection = JSON.parse(await readFile(server.connectionPath, 'utf8'));
    assert.match(server.address, /^http:\/\/127\.0\.0\.1:/);
    assert.equal((await stat(server.connectionPath)).mode & 0o777, 0o600);
    assert.equal((await fetch(`${server.address}/state`)).status, 401);
    const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
    assert.equal(
      (
        await fetch(`${server.address}/notifications`, {
          method: 'POST',
          headers: { ...headers, Origin: 'http://evil.example' },
          body: '{"kind":"email"}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${server.address}/notifications`, {
          method: 'POST',
          headers,
          body: '{"kind":"invalid"}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${server.address}/notifications`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'email', content: 'x'.repeat(520000) }),
        })
      ).status,
      400,
    );
    assert.equal(calls, 0);
    const result = await promisify(execFile)(process.execPath, [
      'scripts/demo-trigger.mjs',
      'email',
      '--connection',
      server.connectionPath,
      '--key',
      'take-1',
    ]);
    assert.equal(JSON.parse(result.stdout).idempotencyKey, 'take-1');
    assert.equal(calls, 1);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
