import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Uses real Codex triage and subscription allowance, with simulated task execution.
const dataDir = await mkdtemp(path.join(tmpdir(), 'office-triage-check-'));
const env = { ...process.env, OFFICE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ args: ['.'], env, timeout: 30_000 });
const results = [];
try {
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => Boolean(window.office));
  const command = (value) => page.evaluate((value) => window.office.command(value), value);
  let state = await command({ type: 'snapshot' });
  assert.equal(state.auth.status, 'signed-in', 'A ChatGPT Codex login is required for actual triage.');
  assert.ok(state.sources.length >= 400, 'Expanded historical context must be loaded.');
  await command({ type: 'settings.update', settings: { mode: 'demo', sound: false } });
  await command({ type: 'demo.speed', speed: 4 });
  const limit = Number(process.env.OFFICE_TRIAGE_LIMIT || 16);
  const events = state.demo.events.slice(0, limit);
  assert.ok(events.length > 0);
  await mkdir('test-results', { recursive: true });
  for (const event of events) {
    const priorCount = state.triage.length;
    console.log(`Delivering ${event.id}: ${event.label}`);
    state = await command({ type: 'demo.deliver', id: event.id });
    const record = state.triage.at(-1);
    if (state.triage.length === priorCount) {
      results.push({ event: event.id, duplicate: true });
      continue;
    }
    const deadline = Date.now() + 240_000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await command({ type: 'snapshot' });
      if (['completed', 'failed'].includes(state.triage.find((item) => item.id === record.id)?.status)) break;
    } while (Date.now() < deadline);
    const decision = state.triage.find((item) => item.id === record.id);
    results.push({ event: event.id, label: event.label, ...decision });
    await writeFile('test-results/triage-decisions.json', JSON.stringify(results, null, 2));
    assert.equal(decision.status, 'completed', decision.error || 'Triage did not finish.');
    assert.ok(decision.threadId, 'The decision must retain its actual Codex thread.');
    if (decision.workId) assert.ok(state.work.some((work) => work.id === decision.workId));
    console.log(`  ${decision.action}: ${decision.reason}`);
    if (state.work.some((work) => work.status === 'running')) {
      await page.screenshot({ path: 'test-results/triage-working.png', fullPage: true });
    }
  }
  const deadline = Date.now() + 60_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await command({ type: 'snapshot' });
    if (!state.work.some((work) => ['running', 'queued'].includes(work.status))) break;
  } while (Date.now() < deadline);
  assert.ok(state.work.some((work) => work.triggerSourceId), 'An arrival must create a source-linked task.');
  assert.ok(state.agents.some((agent) => agent.temporary), 'A task must spawn a temporary worker.');
  const nav = page.locator('.nav-rail');
  await nav.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.screenshot({ path: 'test-results/triage-tasks.png', fullPage: true });
  await writeFile('test-results/triage-outcome.json', JSON.stringify({
    events: results, work: state.work, triage: state.triage, calendar: state.calendar,
    artifacts: state.artifacts, agents: state.agents, board: state.board,
  }, null, 2));
  console.log(`Real triage check passed: ${results.length} deliveries, ${state.work.length} tasks, ${state.agents.filter((agent) => agent.temporary).length} temporary workers.`);
} finally {
  const page = desktop.windows()[0];
  if (page && !page.isClosed()) {
    try {
      const state = await page.evaluate(() => window.office.command({ type: 'snapshot' }));
      await mkdir('test-results', { recursive: true });
      await writeFile('test-results/triage-final-state.json', JSON.stringify({
        triage: state.triage, work: state.work, activity: state.activity,
        artifacts: state.artifacts, calendar: state.calendar,
      }, null, 2));
    } catch (error) { console.error('Could not retain triage diagnostics:', error.message); }
  }
  await desktop.close();
  await rm(dataDir, { recursive: true, force: true });
}
