import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const scenario = process.env.OFFICE_LIVE_SCENARIO || 'report';
assert.ok(['report', 'bug', 'meeting', 'dinner', 'qa'].includes(scenario));
const dataDir = await mkdtemp(path.join(tmpdir(), 'little-office-live-'));
const env = { ...process.env, OFFICE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ args: ['.'], env, timeout: 30_000 });
try {
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => Boolean(window.office));
  const command = (value) => page.evaluate((value) => window.office.command(value), value);
  let state = await command({ type: 'snapshot' });
  assert.equal(state.auth.status, 'signed-in', 'Sign in to Codex with ChatGPT before the live check.');
  await command({ type: 'settings.update', settings: { mode: 'live', sound: false } });
  state = await command({ type: 'scenario.run', scenario });
  const work = state.work.find((item) => item.mode === 'live' && item.scenario === scenario);
  assert.ok(work);
  console.log(`Live ${scenario} started: ${work.id}`);
  const deadline = Date.now() + 300_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = await command({ type: 'snapshot' });
    if (['completed', 'failed', 'cancelled'].includes(state.work.find((item) => item.id === work.id)?.status)) break;
  } while (Date.now() < deadline);
  const completed = state.work.find((item) => item.id === work.id);
  assert.equal(completed.status, 'completed', completed.error);
  const artifact = state.artifacts.find((item) => item.workId === work.id);
  assert.ok(artifact && !artifact.simulated && artifact.content.length > 100, 'Codex must produce a real artifact.');
  assert.ok(state.runs.find((item) => item.workId === work.id)?.threadId, 'Run must retain its actual Codex thread.');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/live-${scenario}.png`, fullPage: true });
  console.log(`Live Codex ${scenario} passed: ${artifact.title}, ${artifact.content.length} characters, ${state.activity.filter((event) => event.workId === work.id).length} activity events.`);
} finally {
  await desktop.close();
  await rm(dataDir, { recursive: true, force: true });
}
