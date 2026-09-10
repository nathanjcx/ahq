import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRuntime, type OfficeRuntime } from '../runtime/engine';
import { initialSnapshot } from '../runtime/fixtures';
import { parseTriageDecision, triagePrompt, type TriageDecision } from '../runtime/triage';
import type { SourceItem } from '../src/shared/types';

const decision = (overrides: Partial<TriageDecision> = {}): TriageDecision => ({
  action: 'create', reason: 'The sender requests a report using attached evidence.', scenario: 'report',
  title: 'Prepare the requested report', goal: 'Summarize the attached customer evidence.', workId: null,
  sourceIds: [], dependsOnWorkIds: [], needsInformation: false, requiresFollowUp: false, calendarDraft: null, ...overrides,
});

function source(id: string, response: Partial<TriageDecision> = {}, extra: Record<string, unknown> = {}): SourceItem {
  return { id, source: 'gmail', externalId: id, threadId: `native-${id}`, author: 'Jordan', title: `Request ${id}`,
    content: `MOCK:${JSON.stringify({ ...decision(response), ...extra })}\nPlease prepare the requested work from this evidence.`, timestamp: Date.now(),
    attachments: [{ id: `attachment-${id}`, name: 'customer.csv', mediaType: 'text/csv', content: 'customer,requests\nHarbor,42\nPinecone,17\n' }],
  };
}

async function setup(): Promise<{ office: OfficeRuntime; directory: string; dataDir: string; close(): Promise<void> }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'office-triage-test-'));
  const executable = path.join(directory, 'codex');
  await writeFile(executable, `#!/usr/bin/env node
if (process.argv.includes('mcp')) { process.stdout.write('[]'); process.exit(0); }
const fs = require('node:fs');
const path = require('node:path');
let count = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const reply = (result) => send({ id: message.id, result });
  if (message.method === 'initialize') reply({});
  if (message.method === 'account/read') reply({ account: { type: 'chatgpt', planType: 'plus' } });
  if (message.method === 'thread/start') reply({ thread: { id: 'thread-' + ++count } });
  if (message.method === 'turn/interrupt') reply({});
  if (message.method !== 'turn/start') return;
  const prompt = message.params.input[0].text;
  fs.appendFileSync(${JSON.stringify(path.join(directory, 'prompts.jsonl'))}, JSON.stringify(prompt) + '\\n');
  const turnId = 'turn-' + count;
  let output;
  let delay = 20;
  if (prompt.startsWith('You are Maya')) {
    const matched = prompt.split('EXISTING TASKS:')[0].match(/MOCK:(.+)\\n/);
    const config = matched ? JSON.parse(matched[1]) : ${JSON.stringify(decision({ scenario: 'meeting', title: 'Prepare the new calendar meeting' }))};
    delay = config.delay || delay;
    const tasks = JSON.parse(prompt.split('EXISTING TASKS:\\n')[1].split('\\n\\nAVAILABLE ARTIFACTS:')[0]);
    const incomingId = prompt.split('NEW MESSAGE:\\nSOURCE ')[1].split(' | ')[0];
    config.sourceIds = config.sourceIds.length ? config.sourceIds : [incomingId];
    if (config.behavior === 'qa-before-bug') {
      const qa = tasks.find((task) => task.scenario === 'qa');
      const bug = tasks.find((task) => task.scenario === 'bug');
      config.action = qa ? 'attach' : 'wait'; config.workId = qa?.id || null;
      config.needsInformation = !bug; config.dependsOnWorkIds = bug ? [bug.id] : [];
    }
    output = config.invalid ? 'not json' : JSON.stringify(config);
  } else {
    const cwd = message.params.cwd;
    if (prompt.includes('patch.md')) {
      const file = path.join(cwd, 'checkout.js');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(' + (coupon > 0 ? tax : 0)', '') + '\\n// ' + prompt.split('\\n')[0]);
      fs.writeFileSync(path.join(cwd, 'patch.md'), '# Fixed this requested checkout task');
      fs.writeFileSync(path.join(cwd, 'test', 'added.test.js'), '// Additional regression coverage from the fix');
      fs.writeFileSync(path.join(cwd, 'qa.md'), '# Old notes from the parent workspace');
    }
    if (prompt.includes('qa.md') && !prompt.includes('omit-qa')) fs.writeFileSync(path.join(cwd, 'qa.md'), fs.readFileSync(path.join(cwd, 'checkout.js'), 'utf8'));
    if (prompt.includes('qa.md') && prompt.includes('mutate-qa')) fs.appendFileSync(path.join(cwd, 'checkout.js'), '\\n// Unauthorized QA change');
    if (prompt.includes('report.md')) fs.writeFileSync(path.join(cwd, 'report.md'), fs.readFileSync(path.join(cwd, 'evidence.md'), 'utf8'));
    if (prompt.includes('brief.md')) fs.writeFileSync(path.join(cwd, 'brief.md'), fs.readFileSync(path.join(cwd, 'evidence.md'), 'utf8'));
    output = 'Completed';
    if (prompt.includes('slow-work')) delay = 350;
    if (message.params.outputSchema?.properties?.start) output = fs.readFileSync(path.join(cwd, 'evidence.md'), 'utf8').split('Validated calendar proposal: ')[1].split('\\n')[0];
  }
  reply({ turn: { id: turnId } });
  const failed = !prompt.startsWith('You are Maya') && prompt.includes('fail-work');
  setTimeout(() => send({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: { id: turnId, status: failed ? 'failed' : 'completed', error: failed ? { message: 'Fixture execution failed' } : null, items: [{ type: 'agentMessage', text: output }] } } }), delay);
});
`, { mode: 0o700 });
  process.env.CODEX_BIN = executable;
  const dataDir = path.join(directory, 'data');
  const office = await createRuntime({ dataDir, onSnapshot: (snapshot) => {
    assert.ok(snapshot.work.filter((work) => work.status === 'running').length <= 2);
    assert.ok(snapshot.triage.filter((record) => record.status === 'running').length <= 1);
  } });
  await office.command({ type: 'demo.speed', speed: 4 });
  return { office, directory, dataDir, close: async () => { await office.close(); await rm(directory, { recursive: true, force: true }); } };
}

async function settled(office: OfficeRuntime, id: string): Promise<void> {
  await waitFor(() => office.snapshot().triage.some((record) => record.sourceId === id && ['completed', 'failed'].includes(record.status)));
}

async function waitFor(predicate: () => boolean, timeout = 8_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for intake or work');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('structured triage validates IDs and cycles, and builds bounded evidence without scenario tags', () => {
  const state = initialSnapshot();
  const incoming = source('incoming');
  incoming.scenario = 'bug';
  incoming.content = 'Please summarize the customer spreadsheet.';
  state.sources.push(incoming);
  const valid = parseTriageDecision(JSON.stringify(decision()), state, incoming.id);
  assert.deepEqual(valid.sourceIds, [incoming.id]);
  assert.throws(() => parseTriageDecision(JSON.stringify(decision({ sourceIds: ['invented-id'] })), state, incoming.id), /unknown source/);
  assert.throws(() => parseTriageDecision(JSON.stringify(decision({ action: 'attach', workId: 'work-welcome', dependsOnWorkIds: ['work-welcome'] })), state, incoming.id), /circular/);
  const prompt = triagePrompt(incoming, state);
  assert.match(prompt, /Harbor,42/);
  assert.ok((prompt.match(/^SOURCE /gm) || []).length <= 33);
  assert.doesNotMatch(prompt.split('NEW MESSAGE:')[1].split('EXISTING TASKS:')[0], /"scenario"/);
});

test('real transport triages incoming events, deduplicates delivery and spawns a worker per distinct request', async () => {
  const app = await setup();
  try {
    const first = source('request-a');
    await app.office.command({ type: 'source.ingest', item: first });
    await app.office.command({ type: 'source.ingest', item: first });
    await settled(app.office, first.id);
    await app.office.command({ type: 'source.ingest', item: source('request-b') });
    await settled(app.office, 'request-b');
    const state = app.office.snapshot();
    const created = state.work.filter((work) => work.triggerSourceId);
    assert.equal(state.triage.length, 2);
    assert.equal(created.length, 2);
    assert.notEqual(created[0].agentId, created[1].agentId);
    assert.ok(created.every((work) => state.agents.find((agent) => agent.id === work.agentId)?.temporary));
    await waitFor(() => app.office.snapshot().work.filter((work) => work.triggerSourceId).every((work) => work.status === 'completed'));
    assert.match(app.office.snapshot().artifacts.at(-1)!.content, /Harbor,42/);
    const prompts = await readFile(path.join(app.directory, 'prompts.jsonl'), 'utf8');
    assert.match(prompts, /NEW MESSAGE/);
  } finally { await app.close(); }
});

test('waiting QA is reconsidered when its bug arrives, consumes the exact patch and does not duplicate', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('early-qa', { scenario: 'qa', title: 'Verify checkout fix' }, { behavior: 'qa-before-bug' }) });
    await settled(app.office, 'early-qa');
    const originalQA = app.office.snapshot().work.find((work) => work.triggerSourceId === 'early-qa')!;
    assert.equal(originalQA.status, 'waiting');
    await app.office.command({ type: 'source.ingest', item: source('new-bug', { scenario: 'bug', title: 'Fix double tax' }) });
    await waitFor(() => app.office.snapshot().work.find((work) => work.id === originalQA.id)?.status === 'completed');
    const state = app.office.snapshot();
    const bug = state.work.find((work) => work.triggerSourceId === 'new-bug')!;
    const qa = state.work.find((work) => work.id === originalQA.id)!;
    assert.equal(state.work.filter((work) => work.scenario === 'qa').length, 1);
    assert.equal(qa.parentWorkId, bug.id);
    assert.ok(qa.inputArtifactIds?.includes(state.artifacts.find((artifact) => artifact.workId === bug.id)!.id));
    assert.equal(state.runs.find((run) => run.workId === qa.id)!.startedAt >= bug.completedAt!, true);
    const parentRun = state.runs.find((run) => run.workId === bug.id)!;
    const qaRun = state.runs.find((run) => run.workId === qa.id)!;
    const proof = JSON.parse(await readFile(path.join(qaRun.workspace!, 'provenance.json'), 'utf8'));
    assert.equal(proof.parentWorkId, bug.id);
    assert.equal(proof.parentRunId, parentRun.id);
    assert.equal(proof.parentWorkspace, parentRun.workspace);
    assert.equal(proof.qaWorkspace, qaRun.workspace);
    assert.notEqual(proof.parentWorkspace, proof.qaWorkspace);
    assert.deepEqual(proof.files.map((file: { path: string }) => file.path).sort(), ['README.md', 'checkout.js', 'package.json', 'test/added.test.js', 'test/checkout.test.js']);
    for (const file of proof.files) {
      const parentBytes = await readFile(path.join(parentRun.workspace!, file.path));
      const copiedBytes = await readFile(path.join(qaRun.workspace!, file.path));
      assert.deepEqual(copiedBytes, parentBytes);
      assert.equal(file.parentSha256, createHash('sha256').update(parentBytes).digest('hex'));
      assert.equal(file.copySha256, file.parentSha256);
    }
    assert.match(await readFile(path.join(qaRun.workspace!, 'evidence.md'), 'utf8'), /Hash identity proves the code provenance, not that tests pass/);
  } finally { await app.close(); }
});

test('a corrected running task gets one follow-up and a completed meeting refreshes from its exact result', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('initial-report') });
    await settled(app.office, 'initial-report');
    const report = app.office.snapshot().work.find((work) => work.triggerSourceId === 'initial-report')!;
    await waitFor(() => app.office.snapshot().work.find((work) => work.id === report.id)?.status === 'completed');
    await app.office.command({ type: 'source.ingest', item: source('meeting', { scenario: 'meeting', title: 'Prepare customer meeting', dependsOnWorkIds: [report.id] }) });
    await waitFor(() => app.office.snapshot().work.find((work) => work.triggerSourceId === 'meeting')?.status === 'completed');
    await app.office.command({ type: 'source.ingest', item: source('correction', { action: 'attach', workId: report.id, requiresFollowUp: true, title: 'Correct customer report' }) });
    await settled(app.office, 'correction');
    await waitFor(() => app.office.snapshot().work.filter((work) => work.followUpOf).length === 2
      && app.office.snapshot().work.filter((work) => work.followUpOf).every((work) => work.status === 'completed'));
    const state = app.office.snapshot();
    const corrected = state.work.find((work) => work.followUpOf === report.id)!;
    const refreshed = state.work.find((work) => work.followUpOf && work.scenario === 'meeting')!;
    assert.ok(refreshed.dependsOnWorkIds?.includes(corrected.id));
    assert.ok(state.artifacts.find((artifact) => artifact.workId === refreshed.id)?.supersedesArtifactId);
    assert.equal(state.work.filter((work) => work.followUpOf === report.id).length, 1);
    await app.office.command({ type: 'source.ingest', item: source('second-correction', { action: 'attach', workId: report.id, requiresFollowUp: true, title: 'Apply the final customer correction' }) });
    await waitFor(() => app.office.snapshot().work.some((work) => work.followUpOf === refreshed.id && work.status === 'completed'));
    const revisedAgain = app.office.snapshot().work.find((work) => work.followUpOf === corrected.id)!;
    const meetingAgain = app.office.snapshot().work.find((work) => work.followUpOf === refreshed.id)!;
    assert.ok(meetingAgain.dependsOnWorkIds?.includes(revisedAgain.id));
  } finally { await app.close(); }
});

test('calendar clarification resumes the same waiting task and uses the proposed time', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('vague-dinner', { action: 'wait', scenario: 'dinner', title: 'Schedule dinner', needsInformation: true, reason: 'Need a date and time.' }) });
    await settled(app.office, 'vague-dinner');
    const work = app.office.snapshot().work.find((work) => work.triggerSourceId === 'vague-dinner')!;
    const start = '2030-10-12T20:15:00-04:00';
    const end = '2030-10-12T21:45:00-04:00';
    await app.office.command({ type: 'source.ingest', item: source('confirmed-dinner', {
      action: 'attach', scenario: 'dinner', workId: work.id, goal: 'Dinner on October12 at8:15PM for90minutes.',
      calendarDraft: { title: 'Dinner', start, end, attendees: ['friend@example.test'], location: 'Cafe', description: 'Confirmed by sender' },
    }) });
    await waitFor(() => app.office.snapshot().work.find((item) => item.id === work.id)?.status === 'completed');
    const state = app.office.snapshot();
    assert.equal(state.work.filter((item) => item.scenario === 'dinner').length, 1);
    assert.equal(state.calendar.at(-1)!.start, new Date(start).toISOString());
    assert.equal(state.calendar.at(-1)!.end, new Date(end).toISOString());
    assert.ok(state.work.find((item) => item.id === work.id)!.sourceIds.includes('confirmed-dinner'));
  } finally { await app.close(); }
});

test('invalid triage is visible, reset cancels late decisions, and missing-information waits survive restart', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('bad-output', {}, { invalid: true }) });
    await settled(app.office, 'bad-output');
    assert.equal(app.office.snapshot().sources.find((item) => item.id === 'bad-output')!.disposition, 'error');
    await app.office.command({ type: 'source.ingest', item: source('slow-output', {}, { delay: 250 }) });
    await waitFor(() => app.office.snapshot().triage.some((record) => record.sourceId === 'slow-output' && record.status === 'running'));
    await app.office.command({ type: 'demo.reset' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(app.office.snapshot().triage.length, 0);
    await app.office.command({ type: 'source.ingest', item: source('waiting-info', { action: 'wait', needsInformation: true, reason: 'Need customer name.' }) });
    await settled(app.office, 'waiting-info');
    const work = app.office.snapshot().work.find((item) => item.triggerSourceId === 'waiting-info')!;
    const anchor = app.office.snapshot().demo.startedAt;
    await app.office.close();
    const reopened = await createRuntime({ dataDir: app.dataDir, onSnapshot: () => undefined });
    try {
      assert.equal(reopened.snapshot().work.find((item) => item.id === work.id)!.status, 'waiting');
      assert.equal(reopened.snapshot().demo.startedAt, anchor);
    } finally { await reopened.close(); }
  } finally { await app.close(); }
});

test('cancelled work ignores a late model result and retry revives its worker', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('cancel-me', { goal: 'slow-work report' }) });
    await settled(app.office, 'cancel-me');
    const work = app.office.snapshot().work.find((item) => item.triggerSourceId === 'cancel-me')!;
    await waitFor(() => app.office.snapshot().runs.some((run) => run.workId === work.id && run.turnId));
    assert.equal(app.office.snapshot().agents.find((agent) => agent.id === work.agentId)!.activity, 'drafting');
    await app.office.command({ type: 'work.cancel', id: work.id });
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(app.office.snapshot().work.find((item) => item.id === work.id)!.status, 'cancelled');
    assert.ok(app.office.snapshot().agents.find((agent) => agent.id === work.agentId)!.retiredAt);
    assert.equal(app.office.snapshot().artifacts.filter((artifact) => artifact.workId === work.id).length, 0);
    await app.office.command({ type: 'work.retry', id: work.id });
    await waitFor(() => app.office.snapshot().work.find((item) => item.id === work.id)!.status === 'completed');
    assert.equal(app.office.snapshot().runs.filter((run) => run.workId === work.id).length, 2);
    assert.equal(app.office.snapshot().agents.find((agent) => agent.id === work.agentId)!.retiredAt, undefined);
  } finally { await app.close(); }
});

test('automatic playback waits for intake and calendar creation triggers actual meeting work', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('slow-intake', { action: 'ignore' }, { delay: 1_800 }) });
    await app.office.command({ type: 'demo.play' });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    assert.equal(app.office.snapshot().demo.nextIndex, 0);
    await app.office.command({ type: 'demo.pause' });
    await settled(app.office, 'slow-intake');
    const count = app.office.snapshot().calendar.length;
    const event = { title: 'Customer review', start: '2031-03-04T15:00:00Z', end: '2031-03-04T15:45:00Z', attendees: ['customer@example.test'], location: 'Office', description: 'Review the supplied customer evidence.' };
    await assert.rejects(app.office.command({ type: 'calendar.create', event: { ...event, end: '2030-01-01T00:00:00Z' } }), /valid start\/end/);
    assert.equal(app.office.snapshot().calendar.length, count);
    await app.office.command({ type: 'calendar.create', event });
    const created = app.office.snapshot().calendar.at(-1)!;
    await waitFor(() => app.office.snapshot().work.some((work) => work.triggerSourceId === created.sourceIds[0] && work.status === 'completed'));
    assert.equal(created.simulated, true);
    const work = app.office.snapshot().work.find((item) => item.triggerSourceId === created.sourceIds[0])!;
    const run = app.office.snapshot().runs.find((item) => item.workId === work.id)!;
    const evidence = await readFile(path.join(run.workspace!, 'evidence.md'), 'utf8');
    assert.match(evidence, /sources\//);
    assert.match(evidence, /attachments\//);
    assert.match(app.office.snapshot().artifacts.find((artifact) => artifact.workId === work.id)!.content, /Customer review/);
  } finally { await app.close(); }
});

test('failed prerequisites stay blocked across restart and interrupted triage remains retryable', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('failed-parent', { goal: 'fail-work report' }) });
    await waitFor(() => app.office.snapshot().work.find((work) => work.triggerSourceId === 'failed-parent')?.status === 'failed');
    const parent = app.office.snapshot().work.find((work) => work.triggerSourceId === 'failed-parent')!;
    await app.office.command({ type: 'source.ingest', item: source('blocked-meeting', { scenario: 'meeting', dependsOnWorkIds: [parent.id] }) });
    await settled(app.office, 'blocked-meeting');
    const child = app.office.snapshot().work.find((work) => work.triggerSourceId === 'blocked-meeting')!;
    assert.equal(child.status, 'waiting');
    assert.match(child.blockedReason!, /failed/);
    await app.office.command({ type: 'source.ingest', item: source('interrupted-intake', {}, { delay: 1_000 }) });
    await waitFor(() => app.office.snapshot().triage.some((record) => record.sourceId === 'interrupted-intake' && record.status === 'running'));
    await app.office.close();
    const reopened = await createRuntime({ dataDir: app.dataDir, onSnapshot: () => undefined });
    try {
      const state = reopened.snapshot();
      assert.equal(state.work.find((work) => work.id === child.id)!.status, 'waiting');
      assert.equal(state.runs.filter((run) => run.workId === child.id).length, 0);
      assert.ok(state.agents.find((agent) => agent.id === parent.agentId)!.retiredAt);
      assert.equal(state.agents.find((agent) => agent.id === child.agentId)!.activity, 'waiting');
      assert.equal(state.triage.find((record) => record.sourceId === 'interrupted-intake')!.status, 'failed');
      assert.equal(state.sources.find((item) => item.id === 'interrupted-intake')!.disposition, 'error');
    } finally { await reopened.close(); }
  } finally { await app.close(); }
});

test('QA cannot publish verification after modifying the copied parent code', async () => {
  const app = await setup();
  try {
    await app.office.command({ type: 'source.ingest', item: source('immutable-fix', { scenario: 'bug', title: 'Fix checkout for immutable QA' }) });
    await waitFor(() => app.office.snapshot().work.some((work) => work.scenario === 'qa' && work.status === 'completed'));
    const parent = app.office.snapshot().work.find((work) => work.triggerSourceId === 'immutable-fix' && work.scenario === 'bug')!;
    await app.office.command({ type: 'source.ingest', item: source('mutating-qa', { scenario: 'qa', title: 'Recheck the parent fix', goal: 'mutate-qa', dependsOnWorkIds: [parent.id] }) });
    await waitFor(() => app.office.snapshot().work.find((work) => work.triggerSourceId === 'mutating-qa')?.status === 'failed');
    const work = app.office.snapshot().work.find((item) => item.triggerSourceId === 'mutating-qa')!;
    assert.match(work.error!, /QA modified checkout\.js/);
    assert.equal(app.office.snapshot().artifacts.some((artifact) => artifact.workId === work.id), false);
    const parentRun = app.office.snapshot().runs.find((run) => run.workId === parent.id)!;
    assert.doesNotMatch(await readFile(path.join(parentRun.workspace!, 'checkout.js'), 'utf8'), /Unauthorized QA change/);
    await app.office.command({ type: 'source.ingest', item: source('missing-qa', { scenario: 'qa', title: 'Require a fresh QA report', goal: 'omit-qa', dependsOnWorkIds: [parent.id] }) });
    await waitFor(() => app.office.snapshot().work.find((item) => item.triggerSourceId === 'missing-qa')?.status === 'failed');
    const missing = app.office.snapshot().work.find((item) => item.triggerSourceId === 'missing-qa')!;
    assert.match(missing.error!, /without producing qa\.md/);
    assert.equal(app.office.snapshot().artifacts.some((artifact) => artifact.workId === missing.id), false);
  } finally { await app.close(); }
});


test('suggested arrivals expose editable previews without leaking future evidence into intake', async () => {
  const app = await setup();
  try {
    const before = app.office.snapshot();
    const event = before.demo.events!.find((item) => item.item?.attachments?.length)!;
    assert.ok(event.item);
    assert.equal(before.sources.some((item) => item.id === event.item!.id), false);
    assert.equal(before.triage.length, 0);
    const changes = { source: event.item.source, author: 'Demo visitor', title: 'Edited incoming request', threadId: event.item.threadId,
      content: source('edited', { action: 'ignore', scenario: null, reason: 'An acknowledgement needs no work.' }).content };
    await assert.rejects(app.office.command({ type: 'demo.deliver', id: event.id, changes: { ...changes, content: '' } }), /invalid/);
    assert.equal(app.office.snapshot().demo.events!.find((item) => item.id === event.id)!.delivered, false);
    await app.office.command({ type: 'demo.deliver', id: event.id, changes });
    await settled(app.office, event.item.id);
    const after = app.office.snapshot();
    const incoming = after.sources.find((item) => item.id === event.item!.id)!;
    assert.ok(incoming.timestamp <= Date.now(), 'Manual arrivals use delivery time, not the old replay offset.');
    assert.equal(incoming.title, changes.title);
    assert.equal(incoming.content, changes.content);
    assert.equal(incoming.author, changes.author);
    assert.equal(incoming.externalId, event.item.externalId);
    assert.deepEqual(incoming.attachments, event.item.attachments);
    assert.equal(after.demo.events!.find((item) => item.id === event.id)!.delivered, true);
    const unseen = after.demo.events!.find((item) => !item.delivered)!.item!;
    assert.equal(triagePrompt(incoming, after).includes(unseen.content), false);
    await app.office.command({ type: 'source.ingest', item: incoming });
    assert.equal(app.office.snapshot().triage.length, 1, 'Provider redelivery must still deduplicate.');
  } finally { await app.close(); }
});
