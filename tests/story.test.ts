import { messageDemoAction } from '../src/shared/demo-labels';
import assert from 'node:assert/strict';
import test from 'node:test';
import { demoEvents, initialCalendar, initialSources } from '../runtime/story';

const now = new Date('2026-09-10T14:00:00Z').getTime();
const history = initialSources();
const deliveries = demoEvents(now);
const identity = (item: { source: string; externalId: string }) => `${item.source}:${item.externalId}`;
const unique = new Map([...history, ...deliveries.map((event) => event.item)].map((item) => [identity(item), item]));

test('the expanded office contains 82 distinct messages and a duplicate delivery', () => {
  assert.equal(history.length, 26);
  assert.equal(unique.size, 82);
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
  for (const item of history) {
    assert.equal(item.disposition, 'ignored');
    assert.ok(item.timestamp >= Date.parse('2026-09-08T00:00:00Z') && item.timestamp < now, 'Archive discussion dates must follow the source export and precede arrivals.');
  }
  for (const event of deliveries) assert.ok(!historicalIds.has(identity(event.item)));
  const attachments = [...unique.values()].flatMap((item) => item.attachments || []);
  assert.ok(attachments.length >= 50, `Only ${attachments.length} attachments provided`);
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

test('Gmail and Slack each have eleven connected arrivals with file-backed attachments', () => {
  for (const source of ['gmail', 'slack']) {
    const sequence = deliveries.filter(event => event.id.startsWith(`arrival-${source}-deep-`));
    assert.equal(sequence.length, 11);
    assert.ok(new Set(sequence.map(event => event.item.threadId)).size <= 2, 'Each sequence stays within its report or bug/QA conversation.');
    assert.ok(sequence.filter(event => event.item.attachments?.length).length >= 8);
    for (const event of sequence) {
      assert.equal(event.item.source, source);
      assert.ok(event.item.content.length > 60);
    }
  }
});


test('every demo message has a display-only action label, including the archive', () => {
  const entries = deliveries.map(entry => ({ ...entry, source: entry.item.source, delivered: false }));
  for (const item of unique.values()) {
    assert.match(messageDemoAction(item, entries) || '', /^\[ACTION: .+\]$/, item.id);
    assert.doesNotMatch(item.title + item.content, /\[ACTION:/);
  }
  assert.ok(deliveries.filter(entry => entry.id.startsWith('arrival-pdf-')).every(entry => entry.item.attachments?.[0].name.endsWith('.csv')));
});
