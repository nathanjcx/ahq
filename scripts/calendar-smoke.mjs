import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real calendar-form → intake → meeting-preparation check. Uses Codex allowance.
const dataDir = await mkdtemp(path.join(tmpdir(), 'office-calendar-check-'));
const env = { ...process.env, OFFICE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ args: ['.'], env, timeout: 30_000 });
try {
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => Boolean(window.office));
  const snapshot = () => page.evaluate(() => window.office.command({ type: 'snapshot' }));
  let state = await snapshot();
  assert.equal(state.auth.status, 'signed-in');
  const count = state.calendar.length;
  await page.locator('.nav-rail').getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'New calendar event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event title', { exact: true }).fill('Harbor Health pilot review');
  const start = new Date(Date.now() + 86_400_000);
  start.setHours(14, 0, 0, 0);
  const local = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await dialog.getByLabel('Starts', { exact: true }).fill(local(start));
  await dialog.getByLabel('Ends', { exact: true }).fill(local(new Date(start.getTime() - 60_000)));
  assert.ok(await dialog.getByRole('button', { name: 'Create event', exact: true }).isDisabled());
  await dialog.getByLabel('Ends', { exact: true }).fill(local(new Date(start.getTime() + 1_800_000)));
  await dialog.getByLabel('Attendees', { exact: true }).fill('leah@example.test, tessa@example.test');
  await dialog.getByLabel('Location', { exact: true }).fill('Harbor office');
  await dialog.getByLabel('Agenda and context', { exact: true }).fill('Prepare a brief from the HBR historical evidence: 84 reminders of 120 planned, front desk questions down from 24 to 11, spending $21,900 of $36,000, and the translated-copy risk. This is a Harbor Health meeting, unrelated to Pinecone.');
  await dialog.getByRole('button', { name: 'Create event', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  state = await snapshot();
  assert.equal(state.calendar.length, count + 1);
  const event = state.calendar.find((item) => item.title === 'Harbor Health pilot review');
  assert.ok(event && event.sourceIds.length);
  console.log('Local calendar event created through the form; awaiting real preparation.');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/calendar-created.png', fullPage: true });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const deadline = Date.now() + 600_000;
  let work;
  do {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await snapshot();
    const triage = state.triage.find((item) => event.sourceIds.includes(item.sourceId));
    assert.notEqual(triage?.status, 'failed', triage?.error);
    work = state.work.find((item) => item.sourceIds.some((id) => event.sourceIds.includes(id)));
    if (work && ['completed', 'failed'].includes(work.status)) break;
  } while (Date.now() < deadline);
  assert.equal(work?.status, 'completed', work?.error || 'Meeting preparation did not finish.');
  const artifact = state.artifacts.find((item) => item.workId === work.id);
  assert.ok(artifact && !artifact.simulated);
  assert.match(artifact.content, /Harbor|HBR/);
  console.log(`Calendar form check passed: real triage and ${artifact.content.length}-character meeting brief.`);
} finally {
  await desktop.close();
  await rm(dataDir, { recursive: true, force: true });
}
