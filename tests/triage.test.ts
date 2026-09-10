import assert from 'node:assert/strict';
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
    const config = JSON.parse(prompt.match(/MOCK:(.+)\\n/)[1]);
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
    }
    if (prompt.includes('qa.md')) fs.writeFileSync(path.join(cwd, 'qa.md'), fs.readFileSync(path.join(cwd, 'checkout.js'), 'utf8'));
    if (prompt.includes('report.md')) fs.writeFileSync(path.join(cwd, 'report.md'), fs.readFileSync(path.join(cwd, 'evidence.md'), 'utf8'));
    if (prompt.includes('brief.md')) fs.writeFileSync(path.join(cwd, 'brief.md'), fs.readFileSync(path.join(cwd, 'evidence.md'), 'utf8'));
    output = 'Completed';
    if (message.params.outputSchema?.properties?.start) output = fs.readFileSync(path.join(cwd, 'evidence.md'), 'utf8').split('Validated calendar proposal: ')[1].split('\\n')[0];
  }
  reply({ turn: { id: turnId } });
  setTimeout(() => send({ method: 'turn/completed', params: { threadId: message.params.threadId, turn: { id: turnId, status: 'completed', items: [{ type: 'agentMessage', text: output }] } } }), delay);
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
