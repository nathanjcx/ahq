import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_NEWS_ACCOUNTS } from '../src/shared/news';
import { aiNewsRoutine, newsWindow, parseNews } from '../runtime/news';
import { initialSnapshot } from '../runtime/fixtures';
import type { Artifact } from '../src/shared/types';

const now = Date.parse('2026-09-10T16:00:00Z');
const window = { since: '2026-09-10T00:00:00Z', until: new Date(now).toISOString() };
const coverage = AI_NEWS_ACCOUNTS.map(account => ({ account, status: 'partial', note: 'Search coverage only.' }));
const post = (published: number, account = 'OpenAI') => ({ account, url: `https://x.com/${account}/status/${((BigInt(published) - 1288834974657n) << 22n).toString()}`, publishedAt: new Date(published).toISOString(), kind: 'announcement', title: 'Test-only announcement', summary: 'Synthetic test data, not real news.' });
const artifact = (news: ReturnType<typeof parseNews>): Artifact => ({ id: 'test-artifact', workId: 'test-work', kind: 'report', title: 'Test', content: '', createdAt: now, simulated: false, news });

test('news accepts current posts and rejects old, future, duplicate, wrong-account and forged-time URLs', () => {
  const valid = post(now - 60_000);
  const old = post(Date.parse(window.since) - 1000);
  const forged = { ...old, publishedAt: valid.publishedAt };
  const result = parseNews(JSON.stringify({ coverage, items: [valid, valid, old, forged, post(now + 1000), { ...valid, account: 'sama' }] }), window, []);
  assert.equal(result.items.length, 1);
  assert.equal(result.excluded, 5);
  const next = parseNews(JSON.stringify({ coverage, items: [valid] }), window, [artifact(result)]);
  assert.equal(next.items.length, 0);
  assert.equal(next.excluded, 1);
});

test('partial coverage retains the previous window; full coverage advances it', () => {
  const result = parseNews(JSON.stringify({ coverage, items: [] }), window, []);
  assert.equal(newsWindow([artifact(result)], now + 600_000).since, window.since);
  result.coverage.forEach(entry => { entry.status = 'checked'; });
  assert.equal(newsWindow([artifact(result)], now + 600_000).since, window.until);
  const first = new Date(newsWindow([], now).since);
  assert.equal(first.getHours(), 0);
  assert.equal(first.getMinutes(), 0);
});

test('all ten account statuses are required and the seeded routine is disabled', () => {
  assert.throws(() => parseNews(JSON.stringify({ coverage: coverage.slice(1), items: [] }), window, []));
  const routine = aiNewsRoutine(now);
  assert.equal(routine.enabled, false);
  assert.equal(routine.intervalMinutes, 10);
  assert.ok(initialSnapshot(now).agents.some(agent => agent.id === routine.agentId));
});
