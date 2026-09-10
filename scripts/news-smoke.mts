import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { initialSnapshot } from '../runtime/fixtures';
import { SnapshotStore } from '../runtime/store';
import { AI_NEWS_ACCOUNTS } from '../src/shared/news';

// Synthetic UI-only records in an isolated profile. No model calls or real news claims.
const dataDir = await mkdtemp(path.join(tmpdir(), 'office-news-ui-'));
const state = initialSnapshot();
const routine = state.routines.find(item => item.kind === 'ai-news')!;
for (let index = 0; index < 2; index++) {
  const id = `news-ui-work-${index}`;
  const time = Date.now() - (2 - index) * 600_000;
  state.work.push({ ...state.work[0], id, title: `UI test collection ${index}`, routineId: routine.id, createdAt: time });
  state.artifacts.push({ id: `news-ui-artifact-${index}`, workId: id, title: `UI test report ${index}`, kind: 'report', content: 'Synthetic test report only.', createdAt: time, simulated: true,
    news: { since: new Date(time - 600_000).toISOString(), until: new Date(time).toISOString(), excluded: 0,
      coverage: AI_NEWS_ACCOUNTS.map(account => ({ account, status: 'partial', note: 'Synthetic test coverage.' })),
      items: [{ account: 'OpenAI', url: `https://x.com/OpenAI/status/${index + 1}`, publishedAt: new Date(time).toISOString(), kind: index ? 'rumor' : 'announcement', title: index ? 'UI test unconfirmed claim' : 'UI test announcement', summary: 'Synthetic UI fixture, not real news.' }] } });
}
const store = await SnapshotStore.open(dataDir); await store.save(state); store.close();
const env = { ...process.env, OFFICE_DATA_DIR: dataDir, CODEX_BIN: '/nonexistent-codex-for-ui-test' }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ ...(process.env.OFFICE_EXECUTABLE ? { executablePath: process.env.OFFICE_EXECUTABLE, args: [] } : { args: ['.'] }), env });
try {
  const page = await desktop.firstWindow();
  await page.locator('.nav-rail').getByRole('button', { name: 'Routines', exact: true }).click();
  await page.locator('.news-item').first().waitFor();
  assert.equal(await page.locator('.news-item').count(), 2);
  await page.getByLabel('News classification').selectOption('rumor');
  assert.equal(await page.locator('.news-item').count(), 1);
  await page.getByLabel('News classification').selectOption('all');
  await page.getByLabel('Search collected news').fill('announcement');
  assert.equal(await page.locator('.news-item').count(), 1);
  await page.getByLabel('Search collected news').fill('');
  await page.locator('.news-coverage summary').click();
  assert.equal(await page.locator('.news-accounts button').count(), 10);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/news-collected.png', fullPage: true });
  await page.getByRole('tab', { name: /Run history/ }).click();
  assert.equal(await page.locator('.routine-result-row').count(), 2);
  await page.getByRole('button', { name: /UI test report 1/ }).click();
  await page.getByRole('dialog').getByText('Synthetic test report only.', { exact: true }).waitFor();
  console.log('News UI passed: cumulative results, filters, ten-account coverage, past runs and report access. No Codex calls.');
} finally { await desktop.close(); await rm(dataDir, { recursive: true, force: true }); }
