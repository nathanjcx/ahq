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
  page.setDefaultTimeout(30_000);
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
  assert.equal(await page.getByRole('button', { name: 'Play replay', exact: true }).count(), 0);
  assert.equal(await page.getByText('Arrival speed', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Simulate an arrival', exact: true }).click();
  await page.getByRole('tab', { name: /Suggested arrivals/ }).waitFor();
  await page.getByRole('tab', { name: /Follow-ups/ }).waitFor();
  await page.screenshot({ path: 'test-results/simulate-arrival.png', fullPage: true });
  const suggested = state.demo.events.find((event) => event.id === 'arrival-launch-request');
  assert.ok(suggested?.item);
  await page.getByRole('dialog').getByRole('button').filter({ hasText: suggested.label }).click();
  const preview = page.getByRole('dialog');
  assert.equal(await preview.getByLabel('Subject', { exact: true }).inputValue(), suggested.item.title);
  assert.equal(await preview.getByLabel('Message', { exact: true }).inputValue(), suggested.item.content);
  await preview.getByLabel('Subject', { exact: true }).fill('Edited preview, not delivered');
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  state = await command({ type: 'snapshot' });
  assert.equal(state.triage.length, 0, 'Preview and cancellation must not send a message.');
  await page.keyboard.press('Escape');
  for (const name of ['New incoming message', 'New calendar event']) {
    await page.getByRole('button', { name: 'Simulate an arrival', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: new RegExp('^' + name) }).click();
    await page.getByRole('dialog').getByRole('heading', { name, exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await page.locator('.nav-rail').getByRole('button', { name: 'Inbox' }).click();
  await page.getByRole('tab', { name: /Slack/ }).click();
  assert.ok((await page.locator('.message-row').count()) > 0);
  assert.ok((await page.locator('.message-row').count()) >= 60);
  await page.getByRole('tab', { name: /Gmail/ }).click();
  assert.ok((await page.locator('.message-row').count()) >= 60);
  const evidence = state.sources.find((source) => source.source === 'gmail' && source.attachments?.length);
  assert.ok(evidence);
  await page.getByRole('textbox', { name: 'Search inbox' }).fill(evidence.title);
  await page.locator('.message-row').first().click();
  await page.locator('.attachment-list summary').first().click();
  assert.ok((await page.locator('.attachment-list pre').first().innerText()).length > 80);
  await page.getByRole('button', { name: 'New incoming message', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Author', { exact: true }).fill('Demo visitor');
  await page.getByRole('dialog').getByLabel('Subject', { exact: true }).fill('A new trigger');
  await page.getByRole('dialog').getByLabel('Message', { exact: true }).fill('Thanks for the notes. Nothing else is needed.');
  await page.screenshot({ path: 'test-results/incoming-composer.png', fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.nav-rail').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();
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
  assert.ok(state.calendar.length >= 3);
  await page.screenshot({ path: 'test-results/calendar.png', fullPage: true });

  if (process.env.OFFICE_TRIGGER_SMOKE === '1') {
    assert.equal(state.auth.status, 'signed-in', 'The real trigger check needs ChatGPT sign-in.');
    await page.locator('.nav-rail').getByRole('button', { name: 'Office', exact: true }).click();
    await page.getByRole('button', { name: 'Simulate an arrival', exact: true }).click();
    const suggestion = state.demo.events.find((event) => event.id === 'arrival-community-social');
    await page.getByRole('dialog').getByRole('button').filter({ hasText: suggestion.label }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Subject', { exact: true }).fill('A quiet hello from the demo');
    const content = 'Hello everyone. I like the little office plants. This is only a social hello, with no request, correction, or new information about any task.';
    await form.getByLabel('Message', { exact: true }).fill(content);
    await form.getByRole('button', { name: 'Deliver message', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    const deadline = Date.now() + 240_000;
    let triage;
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await command({ type: 'snapshot' });
      triage = state.triage.find((item) => item.sourceId === suggestion.item.id);
      if (triage && ['completed', 'failed'].includes(triage.status)) break;
    } while (Date.now() < deadline);
    assert.equal(triage?.status, 'completed', triage?.error || 'Edited suggestion was not triaged.');
    assert.equal(triage.action, 'ignore');
    assert.ok(triage.threadId, 'Edited suggestion must use real Codex.');
    assert.equal(state.sources.find((item) => item.id === suggestion.item.id).content, content);
    console.log('Real edited-trigger check passed: submitted UI content reached Codex and was ignored.');
  }
  assert.deepEqual(errors, [], 'Renderer has no uncaught errors');
  console.log('Electron smoke passed: isolated renderer, inbox filters, agent desktop, routine editing, scene hit targets, board posts, calendar, incoming composer, attachment previews.');
} finally {
  await desktop.close();
  await rm(dataDir, { recursive: true, force: true });
}
