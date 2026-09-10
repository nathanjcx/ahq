import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { SnapshotStore, verifyOfficeAudit } from '../runtime/store';
import { initialState } from '../src/lib/store';
import type { OfficeEventInput } from '../shared/office-events';
const require = createRequire(import.meta.url);
const BASE = Date.UTC(2026, 8, 10, 12);
const event = (id: string, extra: Partial<OfficeEventInput> = {}): OfficeEventInput => ({
  id,
  kind: 'tool.completed',
  summary: 'Completed the recorded office action.',
  source: 'tool',
  employeeId: 'maya',
  toolName: 'memory_search',
  ...extra,
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-office-replay-'));
  let now = BASE;
  const store = await SnapshotStore.open(directory, { now: () => now });
  return {
    store,
    directory,
    time(value: number) {
      now = value;
    },
    async close() {
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('office events are canonical, append-only, monotonic, durable, and idempotent by stable ID', async () => {
  const f = await fixture();
  try {
    const first = await f.store.recordOfficeEvent(event('once'));
    f.time(BASE + 10);
    assert.deepEqual(await f.store.recordOfficeEvent({ ...event('once') }), first);
    await assert.rejects(
      f.store.recordOfficeEvent(event('once', { summary: 'Changed payload' })),
      /different content/,
    );
    await Promise.all(Array.from({ length: 8 }, (_, i) => f.store.recordOfficeEvent(event(`parallel-${i}`))));
    const audit = f.store.exportOfficeAudit();
    assert.deepEqual(
      audit.ledger.map((e) => e.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    assert.equal(audit.ledger[0].previousHash, null);
    assert.equal(audit.ledger[1].previousHash, first.hash);
    assert.equal(audit.verification.verified, true);
    f.store.close();
    const reopened = await SnapshotStore.open(f.directory);
    assert.deepEqual(reopened.exportOfficeAudit().ledger, audit.ledger);
    reopened.close();
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('audited writes commit data and event receipts together or roll everything back', async () => {
  const f = await fixture();
  try {
    await f.store.putAudited('effect', { version: 1 }, [event('original')]);
    await assert.rejects(
      f.store.putAudited('effect', { version: 2 }, [
        event('new'),
        event('original', { summary: 'Conflict' }),
      ]),
      /different content/,
    );
    assert.deepEqual(f.store.get('effect'), { version: 1 });
    assert.deepEqual(
      f.store.exportOfficeAudit().ledger.map((e) => e.id),
      ['original'],
    );
    await f.store.putAudited('effect', { version: 2 }, [event('new')]);
    assert.deepEqual(f.store.get('effect'), { version: 2 });
    assert.equal(f.store.exportOfficeAudit().verification.verified, true);
  } finally {
    await f.close();
  }
});

test('checkpoint hashes anchor exact profile state and event receipts without fabricated earlier evidence', async () => {
  const f = await fixture();
  try {
    const first = initialState();
    first.demo = false;
    await f.store.saveHQ(first, 'Initial configuration');
    f.time(BASE + 100);
    const changed = {
      ...first,
      employees: first.employees.map((e) =>
        e.id === 'maya' ? { ...e, personality: 'Evidence first, concise, curious.' } : e,
      ),
    };
    await f.store.saveHQ(changed, 'Persona updated');
    const audit = f.store.exportOfficeAudit();
    assert.equal(audit.verification.checkpoints.verified, 2);
    assert.equal(audit.verification.verified, true);
    const persona = audit.ledger.find((e) => e.kind === 'employee.configured');
    assert.equal(persona?.employeeId, 'maya');
    assert.equal(persona?.checkpointHash, audit.checkpoints[1].hash);
    assert.deepEqual(f.store.officeReplay(BASE).state, first);
    assert.deepEqual(f.store.officeReplay(BASE + 100).state, changed);
  } finally {
    await f.close();
  }
});

test('replay is one recorded time slice and excludes later backdated or future events, checkpoints, and frames', async () => {
  const f = await fixture();
  try {
    const before = initialState();
    before.goal = 'Earlier goal';
    await f.store.saveHQ(before, 'Earlier snapshot');
    await f.store.recordFrame({ time: BASE, sceneTime: 4, motion: true, listening: false, level: 0 });
    await f.store.recordOfficeEvent(event('visible'));
    f.time(BASE + 1000);
    await f.store.recordOfficeEvent(
      event('late-arrival', { occurredAt: new Date(BASE - 1000).toISOString() }),
    );
    await f.store.recordOfficeEvent(
      event('future-occurrence', { occurredAt: new Date(BASE + 9000).toISOString() }),
    );
    await f.store.saveHQ({ ...before, goal: 'Later goal' }, 'Backdated later write', false, BASE - 500);
    await f.store.recordFrame({ time: BASE + 500, sceneTime: 999, motion: true, listening: false, level: 0 });
    await f.store.put('workspace', { ...before, goal: 'Uncheckpointed live state' });
    const earlier = f.store.officeReplay(BASE + 100);
    assert.equal(earlier.state?.goal, 'Earlier goal');
    assert.equal(earlier.frame?.sceneTime, 4);
    assert.deepEqual(
      earlier.events.filter((e) => e.kind !== 'checkpoint.saved').map((e) => e.id),
      ['visible'],
    );
    assert.ok(earlier.bounds.lastAt! <= earlier.requestedAt);
    const later = f.store.officeReplay(BASE + 1000);
    assert.ok(later.events.some((e) => e.id === 'late-arrival'));
    assert.ok(!later.events.some((e) => e.id === 'future-occurrence'));
    assert.notEqual(later.state?.goal, 'Uncheckpointed live state');
    assert.equal(later.frame?.sceneTime, 999);
  } finally {
    await f.close();
  }
});

test('replay returns no live fallback before coverage and freezes stale frames within recorded bounds', async () => {
  const f = await fixture();
  try {
    await f.store.saveHQ(initialState());
    await f.store.recordFrame({ time: BASE, sceneTime: 10, motion: true, listening: false, level: 0 });
    const empty = f.store.officeReplay(BASE - 1);
    assert.equal(empty.state, null);
    assert.equal(empty.frame, null);
    assert.equal(empty.coverage.status, 'unavailable');
    const after = f.store.officeReplay(BASE + 20000);
    assert.equal(after.frame?.sceneTime, 10);
    assert.equal(after.coverage.status, 'partial');
    assert.ok(after.coverage.gaps.some((gap) => gap.includes('without extrapolation')));
    assert.equal(f.store.officeRecordingBounds().frames.lastAt, BASE);
    await assert.rejects(
      f.store.recordFrame({ time: BASE, sceneTime: 11, motion: true, listening: false, level: 0 }),
      /cannot be changed/,
    );
    await assert.rejects(
      f.store.recordFrame({
        time: BASE + 1,
        sceneTime: Number.NaN,
        motion: false,
        listening: false,
        level: 0,
      }),
    );
  } finally {
    await f.close();
  }
});

test('bounded replay reports truncation and does not expose future event summaries', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) {
      f.time(BASE + i);
      await f.store.recordOfficeEvent(event(`e-${i}`));
    }
    const replay = f.store.officeReplay(BASE + 3, { eventLimit: 2 });
    assert.deepEqual(
      replay.events.map((e) => e.id),
      ['e-2', 'e-3'],
    );
    assert.equal(replay.coverage.eventsTruncated, true);
    assert.equal(replay.audit.ledger.count, 4);
    assert.ok(replay.events.every((e) => Date.parse(e.recordedAt) <= replay.requestedAt));
  } finally {
    await f.close();
  }
});

test('audit verification detects payload tampering, missing tails, and modified checkpoint/frame data', async () => {
  const f = await fixture();
  try {
    await f.store.saveHQ(initialState());
    await f.store.recordFrame({ time: BASE, sceneTime: 1, listening: false, level: 0, motion: true });
    await f.store.recordOfficeEvent(event('final-event'));
    const original = f.store.exportOfficeAudit();
    assert.equal(verifyOfficeAudit(original).verified, true);
    const eventChanged = structuredClone(original);
    eventChanged.ledger[0].summary = 'Altered';
    assert.equal(verifyOfficeAudit(eventChanged).ledger.valid, false);
    const deleted = structuredClone(original);
    deleted.ledger.pop();
    assert.equal(verifyOfficeAudit(deleted).ledger.valid, false);
    const stateChanged = structuredClone(original);
    stateChanged.checkpoints[0].state.goal = 'Altered';
    assert.equal(verifyOfficeAudit(stateChanged).checkpoints.invalid, 1);
    const frameChanged = structuredClone(original);
    frameChanged.frames[0].frame.sceneTime = 123;
    assert.equal(verifyOfficeAudit(frameChanged).frames.invalid, 1);
    f.store.close();
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
    const db = new SQL.Database(await readFile(path.join(f.directory, 'office.sqlite')));
    db.run('UPDATE hq_history SET state=? WHERE id=1', [JSON.stringify(stateChanged.checkpoints[0].state)]);
    await writeFile(path.join(f.directory, 'office.sqlite'), db.export());
    db.close();
    const reopened = await SnapshotStore.open(f.directory, { now: () => BASE });
    const replay = reopened.officeReplay(BASE);
    assert.equal(replay.state, null);
    assert.equal(replay.checkpoint?.verified, false);
    reopened.close();
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('legacy SQLite history stays visibly unverified after migration and new evidence starts a fresh chain', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-office-legacy-'));
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  const db = new SQL.Database(),
    state = initialState();
  db.run(
    'CREATE TABLE hq_history (id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL)',
  );
  db.run('CREATE TABLE hq_frames (time INTEGER PRIMARY KEY,value TEXT NOT NULL)');
  db.run('INSERT INTO hq_history(time,reason,state) VALUES(?,?,?)', [
    BASE - 1000,
    'Legacy snapshot',
    JSON.stringify(state),
  ]);
  db.run('INSERT INTO hq_frames(time,value) VALUES(?,?)', [
    BASE - 1000,
    JSON.stringify({ time: BASE - 1000, sceneTime: 1, listening: false, level: 0, motion: true }),
  ]);
  await writeFile(path.join(directory, 'office.sqlite'), db.export());
  db.close();
  const store = await SnapshotStore.open(directory, { now: () => BASE });
  try {
    const legacy = store.officeReplay(BASE - 1000);
    assert.deepEqual(legacy.state, state);
    assert.equal(legacy.checkpoint?.verified, false);
    assert.equal(legacy.coverage.legacyUnverified, true);
    assert.equal(legacy.events.length, 0);
    await store.saveHQ({ ...state, goal: 'New recorded goal' }, 'First verified checkpoint');
    const audit = store.exportOfficeAudit();
    assert.equal(audit.verification.checkpoints.legacy, 1);
    assert.equal(audit.verification.checkpoints.verified, 1);
    assert.equal(audit.verification.frames.legacy, 1);
    assert.equal(audit.verification.verified, false);
    assert.equal(audit.ledger[0].sequence, 1);
    assert.equal(audit.ledger[0].previousHash, null);
    assert.equal(audit.checkpoints[0].hash, null);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
