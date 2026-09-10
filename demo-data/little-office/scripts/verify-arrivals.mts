import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRuntime } from '../runtime/engine';

// Real model verification. Keeps its isolated office and outputs for inspection.
const outputRoot = path.resolve('test-results');
await mkdir(outputRoot, { recursive: true });
const dataDir = await mkdtemp(path.join(outputRoot, 'arrivals-'));
const office = await createRuntime({ dataDir, onSnapshot: () => undefined });
const decisions: unknown[] = [];
async function waitFor(check: () => boolean, timeout: number, description: string) {
  const deadline = Date.now() + timeout;
  let lastNotice = Date.now();
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (Date.now() - lastNotice > 30_000) {
      const state = office.snapshot();
      console.log(JSON.stringify({ waitingFor: description, running: state.work.filter(work => work.status === 'running').map(work => work.title) }));
      lastNotice = Date.now();
    }
  }
}
try {
  assert.equal(office.snapshot().auth.status, 'signed-in', 'Sign in to Codex with ChatGPT before this check.');
  const requested = process.env.OFFICE_VERIFY_EVENTS?.split(',');
  const catalog = office.snapshot().demo.events!;
  const events = requested ? requested.map(id => { const event = catalog.find(entry => entry.id === id); assert.ok(event, `Unknown arrival ${id}`); return event; }) : catalog;
  console.log(`Verifying ${events.length} arrivals. Local files: ${dataDir}`);
  for (const event of events) {
    const before = office.snapshot();
    const previousIds = new Set(before.triage.map(record => record.id));
    await office.command({ type: 'demo.deliver', id: event.id });
    const record = office.snapshot().triage.find(item => !previousIds.has(item.id));
    if (!record) {
      assert.equal(office.snapshot().sources.length, before.sources.length, 'A delivery cannot silently bypass triage.');
      decisions.push({ eventId: event.id, duplicate: true });
      console.log(`${event.id}: duplicate suppressed`);
      continue;
    }
    await waitFor(() => ['completed', 'failed'].includes(office.snapshot().triage.find(item => item.id === record.id)!.status), 300_000, event.id);
    const result = office.snapshot().triage.find(item => item.id === record.id)!;
    decisions.push({ eventId: event.id, ...result });
    await writeFile(path.join(dataDir, 'decisions.json'), JSON.stringify(decisions, null, 2));
    assert.equal(result.status, 'completed', `${event.id}: ${result.error}`);
    assert.ok(result.threadId, 'Triage must retain its actual Codex thread.');
    console.log(`${event.id}: ${result.action} ${result.reason}`);
  }
  await waitFor(() => {
    const state = office.snapshot();
    return !state.work.some(work => ['queued', 'running'].includes(work.status)) && !state.triage.some(record => ['queued', 'running'].includes(record.status));
  }, 1_200_000, 'all ready work to complete');
  const state = office.snapshot();
  assert.deepEqual(state.work.filter(work => work.status === 'failed').map(work => ({ title: work.title, error: work.error })), []);
  assert.deepEqual(state.triage.filter(record => record.status === 'failed'), []);
  if (!requested) assert.deepEqual(state.work.filter(work => work.status === 'waiting').map(work => ({ title: work.title, reason: work.blockedReason })), [], 'The full catalog must supply all necessary clarifications.');
  const artifacts = state.artifacts.filter(artifact => !artifact.simulated);
  assert.ok(artifacts.length);
  for (const artifact of artifacts) {
    assert.ok(artifact.filePath, artifact.title);
    assert.ok((await readFile(artifact.filePath!, 'utf8')).trim().length > 80, `${artifact.title} must exist as a substantive local file.`);
  }
  console.log(`PASS: ${events.length} arrivals, ${state.work.filter(work => work.triggerSourceId).length} tasks, ${artifacts.length} real artifacts. Evidence retained in ${dataDir}`);
} finally {
  const state = office.snapshot();
  await writeFile(path.join(dataDir, 'outcome.json'), JSON.stringify({ decisions, sources: state.sources, triage: state.triage, work: state.work, runs: state.runs, artifacts: state.artifacts, calendar: state.calendar, activity: state.activity }, null, 2));
  await office.close();
}
