import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { initialSnapshot } from '../runtime/fixtures';
import { SnapshotStore } from '../runtime/store';

const dir = await mkdtemp(path.join(os.tmpdir(), 'office-calendar-ui-'));
const state = initialSnapshot();
const meeting = state.calendar.find(event => event.id === 'calendar-review-sales')!;
const sourceId = 'source-prep-calendar-review-sales';
meeting.sourceIds.push(sourceId);
state.work.push({ ...state.work[0], id: 'calendar-ui-work', title: 'Sales meeting preparation', scenario: 'meeting', triggerSourceId: sourceId, sourceIds: [sourceId] });
state.artifacts.push({ id: 'calendar-ui-brief', workId: 'calendar-ui-work', title: 'Sales meeting notes', kind: 'brief', content: '# Test meeting notes\n\nProposed decisions are not approved.', simulated: true, createdAt: Date.now() });
const store = await SnapshotStore.open(dir); await store.save(state); store.close();
const env = { ...process.env, OFFICE_DATA_DIR: dir, CODEX_BIN: '/nonexistent-calendar-test' }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.locator('.nav-rail').getByRole('button', { name: 'Calendar', exact: true }).click();
  const card = page.locator('.calendar-agenda__event').filter({ hasText: 'Sales review: September margin' });
  await card.getByText('Meeting notes ready', { exact: true }).waitFor();
  assert.match(await card.innerText(), /Q4 priorities/);
  assert.match(await card.innerText(), /Alex Morgan/);
  await card.locator('.calendar-agenda-details > summary').click();
  assert.match(await card.locator('.calendar-agenda__description').innerText(), /5 min/);
  await card.locator('.calendar-agenda-details > summary').click();
  await card.locator('.calendar-pre-reads > summary').click();
  await card.locator('.attachment-list summary').click();
  assert.match(await card.locator('.attachment-list pre').innerText(), /July,Starter,120/);
  await card.locator('.calendar-pre-reads > summary').click();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/calendar-meeting.png', fullPage: true });
  assert.equal(await page.locator('.calendar-agenda__event').filter({ hasText: 'Focus time: Pinecone' }).getByRole('button', { name: 'Prepare meeting notes' }).count(), 0);
  await card.getByRole('button', { name: 'View meeting notes' }).click();
  await page.getByRole('dialog').getByText('Proposed decisions are not approved.', { exact: true }).waitFor();
  console.log('Calendar UI passed: agenda, attendees, CSV pre-read, preparation status, saved notes, and focus blocks. No model calls.');
} finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
