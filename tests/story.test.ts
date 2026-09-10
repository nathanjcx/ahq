import assert from 'node:assert/strict';
import test from 'node:test';
import { demoEvents, initialCalendar, initialSources } from '../runtime/story';

const now = new Date('2026-09-10T14:00:00Z').getTime();
const history = initialSources(now);
const deliveries = demoEvents(now);
const identity = (item: { source: string; externalId: string }) => `${item.source}:${item.externalId}`;
const unique = new Map([...history, ...deliveries.map((event) => event.item)].map((item) => [identity(item), item]));

test('the expanded office contains 480 distinct messages and a duplicate delivery', () => {
  assert.equal(history.length, 450);
  assert.equal(unique.size, 480);
  assert.equal(new Set(history.map(identity)).size, history.length);
  assert.equal(new Set(deliveries.map((event) => event.id)).size, deliveries.length);
  assert.ok(deliveries.length > new Set(deliveries.map((event) => identity(event.item))).size);
  assert.equal(new Set([...unique.values()].map((item) => item.source)).size, 7);
  for (const item of unique.values()) {
    assert.ok(item.id && item.externalId && item.threadId && item.author && item.title);
    assert.ok(item.content.trim().length >= 40, `${item.id} should contain usable message context`);
    assert.equal(item.scenario, undefined, 'Source content must not carry a hidden triage answer.');
  }
});

test('historical context and future arrivals are separate, with readable evidence', () => {
  const historicalIds = new Set(history.map(identity));
  for (const item of history) assert.equal(item.disposition, 'ignored');
  for (const event of deliveries) assert.ok(!historicalIds.has(identity(event.item)));
  const attachments = [...unique.values()].flatMap((item) => item.attachments || []);
  assert.ok(attachments.length >= 80, `Only ${attachments.length} attachments provided`);
  for (const attachment of attachments) {
    assert.ok(attachment.id && attachment.name && attachment.mediaType);
    assert.ok(attachment.content.trim().length >= 80, `${attachment.name} needs readable evidence`);
  }
  const calendar = initialCalendar(now);
  assert.ok(calendar.length > 1, 'Calendar context should include a real scheduling conflict.');
  for (const event of calendar) {
    assert.ok(Date.parse(event.end) > Date.parse(event.start));
    assert.equal(event.simulated, true);
  }
});
