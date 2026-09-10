import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyProjectEvidence, demoDataDirectory, readProjectEvidence } from '../runtime/evidence';
import { copyBugFixture, createBugFixture } from '../runtime/fixtures';
import { createRuntime } from '../runtime/engine';
import { demoEvents, initialCalendar, initialSources } from '../runtime/story';
import { relevantSources } from '../runtime/triage';
import type { Snapshot, WorkItem } from '../src/shared/types';

const now = Date.parse('2026-09-10T14:00:00Z');

test('historical attachments read the checked-in project files exactly', async () => {
  const sources = initialSources(now);
  for (const source of sources) {
    const project = source.id.split('-')[1];
    for (const attachment of source.attachments || []) {
      assert.equal(attachment.content, await readFile(path.join(demoDataDirectory, 'projects', project, attachment.name), 'utf8'));
    }
  }
  assert.throws(() => readProjectEvidence('../arrivals', 'sequence.json'), /Invalid/);
});

test('workspaces receive all project evidence and the real checkout, with no future arrivals', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'office-evidence-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await copyBugFixture(await createBugFixture(workspace), workspace);
  await copyProjectEvidence(workspace);
  for (const file of await readdir(path.join(demoDataDirectory, 'projects'), { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const source = path.join(file.parentPath, file.name);
    const relative = path.relative(path.join(demoDataDirectory, 'projects'), source);
    assert.equal(await readFile(path.join(workspace, 'data', 'projects', relative), 'utf8'), await readFile(source, 'utf8'));
    assert.ok(!/corrected|correction|sequence\.json/.test(relative), relative);
  }
  assert.deepEqual(await readdir(path.join(workspace, 'data')), ['projects']);
  assert.equal(await readFile(path.join(workspace, 'checkout.js'), 'utf8'), await readFile(path.join(demoDataDirectory, 'checkout', 'checkout.js'), 'utf8'));
  await writeFile(path.join(workspace, 'checkout.js'), 'a workspace change');
  assert.notEqual(await readFile(path.join(demoDataDirectory, 'checkout', 'checkout.js'), 'utf8'), 'a workspace change');
});

test('evidence copying refuses a destination symlink', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'office-evidence-link-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'office-evidence-outside-'));
  t.after(() => Promise.all([workspace, outside].map((dir) => rm(dir, { recursive: true, force: true }))));
  await symlink(outside, path.join(workspace, 'data'));
  await assert.rejects(copyProjectEvidence(workspace), /symlink/);
  assert.deepEqual(await readdir(outside), []);
});

test('delivered corrections contain parseable records and family dates resolve the waiting request', () => {
  const arrivals = demoEvents(now);
  const correction = arrivals.find((event) => event.id === 'arrival-support-correction')!.item.attachments![0];
  const rows = correction.content.trim().split('\n').slice(1).map((line) => line.split(','));
  assert.equal(rows.filter((row) => row[2] === 'current').length, 18);
  assert.equal(rows.filter((row) => row[2] === 'current' && row[4] === 'true').length, 17);
  assert.ok(arrivals.find((event) => event.id === 'arrival-beacon-correction')!.item.attachments![0].content.includes('\n\n'));
  const vague = arrivals.find((event) => event.id === 'arrival-personal-date-vague')!.item;
  const confirmed = arrivals.find((event) => event.id === 'arrival-personal-date-confirmed')!.item;
  assert.equal(confirmed.threadId, vague.threadId);
  const visit = JSON.parse(confirmed.attachments![0].content);
  assert.equal(new Date(visit.start).getMonth(), 9);
  assert.equal(Date.parse(visit.end) - Date.parse(visit.start), 2 * 60 * 60 * 1000);
  for (const id of ['calendar-beacon', 'calendar-lumen']) assert.ok(initialCalendar(now).some((event) => event.id === id));
});

test('short project codes find their evidence without unrelated projects', () => {
  for (const code of ['PIN', 'HBR', 'LIB', 'BG', 'NS']) {
    const matches = relevantSources(code, initialSources(now));
    assert.ok(matches.length > 0);
    assert.ok(matches.every((source) => source.title.startsWith(`${code} ·`)), code);
  }
});

test('Gmail and Slack sequences load their checked-in attachments as arrival inputs', async () => {
  const arrivals = demoEvents(now);
  for (const provider of ['gmail', 'slack']) {
    const sequence = JSON.parse(await readFile(path.join(demoDataDirectory, 'arrivals', provider, 'sequence.json'), 'utf8'));
    assert.ok(sequence.length >= 10);
    for (const record of sequence) {
      const source = arrivals.find((event) => event.id === `arrival-${record.id}`)!.item;
      assert.equal(source.source, provider);
      assert.equal(source.content, record.content);
      for (const file of record.attachments || []) {
        assert.equal(source.attachments!.find((attachment) => attachment.name === file)!.content,
          await readFile(path.join(demoDataDirectory, 'arrivals', provider, file), 'utf8'));
      }
    }
  }
  const attachments = arrivals.flatMap((event) => event.item.attachments || []);
  assert.ok(attachments.some((attachment) => attachment.name.endsWith('.js') && attachment.mediaType === 'text/javascript'));
  assert.ok(attachments.some((attachment) => attachment.name.endsWith('.txt') && attachment.mediaType === 'text/plain'));
});

for (const status of ['queued', 'waiting', 'running', 'completed'] as const) {
  test(`a revised prerequisite refreshes a ${status} brief once without a dependency cycle`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'office-refresh-'));
    const previous = process.env.CODEX_BIN;
    process.env.CODEX_BIN = path.join(directory, 'no-codex');
    const office = await createRuntime({ dataDir: directory, onSnapshot: () => undefined });
    t.after(async () => {
      await office.close();
      if (previous === undefined) delete process.env.CODEX_BIN;
      else process.env.CODEX_BIN = previous;
      await rm(directory, { recursive: true, force: true });
    });
    const internal = office as unknown as { state: Snapshot; refreshMeetingBriefs(work: WorkItem): void; refreshDependencies(): void };
    const oldReport = internal.state.work[0];
    const revised: WorkItem = { ...oldReport, id: 'revised-report', followUpOf: oldReport.id, sourceIds: ['source-support-correction'] };
    const meeting: WorkItem = { ...oldReport, id: 'meeting', scenario: 'meeting', status, triggerSourceId: 'source-meeting', dependsOnWorkIds: [oldReport.id], sourceIds: ['source-meeting'], needsInformation: false };
    internal.state.work.push(revised, meeting);
    internal.refreshMeetingBriefs(revised);
    internal.refreshMeetingBriefs(revised);
    internal.refreshDependencies();
    const refreshes = internal.state.work.filter((work) => work.followUpOf === meeting.id);
    if (status === 'queued' || status === 'waiting') {
      assert.equal(refreshes.length, 0);
      assert.deepEqual(meeting.dependsOnWorkIds, [revised.id]);
    } else {
      assert.equal(refreshes.length, 1);
      assert.deepEqual(refreshes[0].dependsOnWorkIds, [meeting.id, revised.id]);
      assert.equal(refreshes[0].status, status === 'running' ? 'waiting' : 'queued');
    }
    const latest = refreshes[0] || meeting;
    assert.ok(latest.sourceIds.includes('source-support-correction'));
    assert.ok(!latest.dependsOnWorkIds!.includes(latest.id));
  });
}
