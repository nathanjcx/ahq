import { fork } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Exercise real Codex login without changing the user's existing credentials.
const directory = await mkdtemp(path.join(tmpdir(), 'little-office-auth-'));
const codexHome = path.join(directory, 'codex');
await mkdir(codexHome);
await writeFile(path.join(codexHome, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
const child = fork('dist-electron/runtime-host.cjs', [], {
  env: { ...process.env, CODEX_HOME: codexHome, OFFICE_DATA_DIR: path.join(directory, 'data') },
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
});
let sequence = 0;
const pending = new Map();
child.on('message', (message) => {
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id); clearTimeout(item.timer);
  if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
});
function command(command) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Authentication check timed out.')); }, 30_000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, command });
  });
}
try {
  const initial = await command({ type: 'snapshot' });
  assert.equal(initial.auth.status, 'signed-out');
  const login = await command({ type: 'auth.login' });
  assert.equal(login.auth.status, 'signing-in');
  assert.equal(new URL(login.auth.loginUrl).hostname, 'auth.openai.com');
  await command({ type: 'auth.cancel' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const cancelled = await command({ type: 'snapshot' });
  assert.equal(cancelled.auth.status, 'signed-out');
  console.log('Real authentication check passed: isolated signed-out account, official ChatGPT login URL, cancellation.');
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  if (child.connected) child.send({ type: 'shutdown' });
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await rm(directory, { recursive: true, force: true });
}
