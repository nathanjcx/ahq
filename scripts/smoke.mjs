import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dataDir = await mkdtemp(path.join(tmpdir(), 'little-office-smoke-'));
const env = { ...process.env, OFFICE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const desktop = await electron.launch({ ...(process.env.OFFICE_EXECUTABLE ? { executablePath: process.env.OFFICE_EXECUTABLE, args: [] } : { args: ['.'] }), env, timeout: 30_000 });
try {
  const page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.office), null, { timeout: 30_000 });
  const command = (value) => page.evaluate((value) => window.office.command(value), value);
  let state = await command({ type: 'snapshot' });
  assert.equal(new Set(state.sources.map((source) => source.source)).size, 7);
  assert.equal(state.agents.length, 6);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/office.png', fullPage: true });
  await page.locator('.nav-rail').getByRole('button', { name: 'Inbox' }).click();
  await page.getByRole('tab', { name: /Slack/ }).click();
  assert.ok((await page.locator('.message-row').count()) > 0);
  assert.match(await page.locator('.message-detail').innerText(), /Checkout|QA/);
  await page.getByRole('tab', { name: /Gmail/ }).click();
  assert.match(await page.locator('.message-detail').innerText(), /leadership|Dinner/i);
  await page.locator('.nav-rail').getByRole('button', { name: 'Routines' }).click();
  await page.locator('.workspace').getByRole('button', { name: 'New routine' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('UI-created routine');
  await page.getByRole('dialog').getByLabel('Instructions', { exact: true }).fill('Review the supplied launch notes and summarize changes.');
  await page.getByRole('button', { name: 'Save routine' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('heading', { name: 'UI-created routine' }).isVisible());
  await page.getByRole('button', { name: 'Edit UI-created routine' }).click();
  assert.equal(await page.getByRole('dialog').getByLabel('Name', { exact: true }).inputValue(), 'UI-created routine');
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Edited routine');
  await page.getByRole('button', { name: 'Save routine' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Delete Edited routine' }).click();
  await page.getByRole('heading', { name: 'Edited routine' }).waitFor({ state: 'hidden' });
  await page.locator('.nav-rail').getByRole('button', { name: 'Office', exact: true }).click();
  await page.locator('.roster').getByRole('button', { name: /Eli Navarro/ }).click();
  assert.ok(await page.getByRole('dialog').isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await command({ type: 'demo.speed', speed: 4 });
  state = await command({ type: 'scenario.run', scenario: 'report' });
  const report = state.work.find((work) => work.scenario === 'report' && work.status !== 'completed');
  assert.ok(report, 'Report scenario creates work');
  const deadline = Date.now() + 60_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await command({ type: 'snapshot' });
    if (state.work.find((work) => work.id === report.id)?.status === 'completed') break;
  } while (Date.now() < deadline);
  assert.equal(state.work.find((work) => work.id === report.id)?.status, 'completed');
  assert.ok(state.artifacts.some((artifact) => artifact.workId === report.id && artifact.content.length > 100));
  assert.ok(state.activity.some((event) => event.workId === report.id));
  const count = state.routines.length;
  state = await command({ type: 'routine.save', routine: {
    agentId: state.agents[5].id, name: 'Smoke-test research', instructions: 'Review the supplied project notes.',
    enabled: false, schedule: 'interval', intervalMinutes: 30, dailyTime: '09:00', notes: '',
  } });
  assert.equal(state.routines.length, count + 1);
  const routine = state.routines.find((item) => item.name === 'Smoke-test research');
  state = await command({ type: 'routine.delete', id: routine.id });
  assert.equal(state.routines.length, count);
  await page.screenshot({ path: 'test-results/office-completed.png', fullPage: true });
  // Exercise the scene's hit targets, not only its accessible roster.
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.click(canvas.x + canvas.width * 210 / 720, canvas.y + canvas.height * 135 / 480);
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByLabel('Leave a note', { exact: true }).fill('Please cross-check the meeting brief.');
  await page.getByRole('button', { name: 'Post note', exact: true }).click();
  await page.getByText('Please cross-check the meeting brief.', { exact: true }).waitFor();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const room = await page.locator('canvas').boundingBox();
  await page.mouse.click(room.x + room.width * 639 / 720, room.y + room.height * 34 / 480);
  await page.getByRole('heading', { name: 'Calendar', exact: true }).waitFor();
  for (const scenario of ['bug', 'meeting', 'dinner', 'qa']) {
    state = await command({ type: 'scenario.run', scenario });
    const work = state.work.find((item) => item.scenario === scenario && item.status !== 'completed');
    assert.ok(work);
    const deadline = Date.now() + 60_000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await command({ type: 'snapshot' });
      if (state.work.find((item) => item.id === work.id)?.status === 'completed') break;
    } while (Date.now() < deadline);
    assert.equal(state.work.find((item) => item.id === work.id)?.status, 'completed', scenario);
    assert.ok(state.artifacts.some((item) => item.workId === work.id && item.content.length > 100));
  }
  assert.ok(state.calendar.some((item) => /dinner/i.test(item.title)));
  await page.screenshot({ path: 'test-results/calendar.png', fullPage: true });

  assert.deepEqual(errors, [], 'Renderer has no uncaught errors');
  console.log('Electron smoke passed: isolated renderer, inbox filters, agent desktop, routine editing, scene hit targets, board posts, calendar, all five scenarios, artifacts.');
} finally {
  await desktop.close();
  await rm(dataDir, { recursive: true, force: true });
}
