import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceReplayTime,
  clampReplayTime,
  replayEventTime,
  selectReplayBundle,
  stepReplayEvent,
  REPLAY_SPEEDS,
} from '../src/lib/replay-clock';
import type { OfficeEvent, OfficeRecordingBounds, OfficeReplayBundle } from '../shared/office-events';
import { initialState } from '../src/lib/store';

const range = { firstAt: 1_000, lastAt: 11_000, count: 3 };
const bounds: OfficeRecordingBounds = {
  firstAt: 1_000,
  lastAt: 11_000,
  checkpoints: { ...range },
  frames: { ...range },
  events: { ...range },
};
function event(sequence: number, recorded: number, occurred = recorded): OfficeEvent {
  return {
    id: `e${sequence}`,
    sequence,
    version: 1,
    kind: 'system',
    source: 'system',
    summary: 'Recorded observation',
    occurredAt: new Date(occurred).toISOString(),
    recordedAt: new Date(recorded).toISOString(),
    hash: 'a'.repeat(64),
    previousHash: null,
  };
}
function bundle(at: number): OfficeReplayBundle {
  return {
    requestedAt: at,
    state: initialState(),
    checkpoint: null,
    frame: null,
    events: [event(1, at)],
    bounds,
    coverage: {
      status: 'partial',
      from: at,
      through: at,
      gaps: ['No frame'],
      legacyUnverified: false,
      eventsTruncated: false,
    },
    audit: {
      verified: false,
      integrityScope: 'local-hash-consistency',
      ledger: { count: 1, headHash: null, valid: true },
      checkpoints: { verified: 0, legacy: 0, invalid: 0 },
      frames: { verified: 0, legacy: 0, invalid: 0 },
      issues: [],
      legacyUnverified: false,
    },
  };
}

test('replay stops exactly at its fixed endpoint at every supported speed and never becomes live', () => {
  const captured = structuredClone(bounds);
  for (const speed of REPLAY_SPEEDS) {
    assert.equal(advanceReplayTime(1_000, 20_000, speed, captured), 11_000);
    assert.equal(advanceReplayTime(1_000, 20_000_000, speed, captured), 11_000);
  }
  assert.equal(advanceReplayTime(1_000, 12.5, 1, captured), 1013);
  assert.equal(clampReplayTime(999, captured), 1000);
  assert.equal(clampReplayTime(Infinity, captured), null);
  assert.equal(clampReplayTime(1000, { ...captured, firstAt: null, lastAt: null }), null);
  assert.deepEqual(captured, bounds);
});

test('event stepping respects both timestamps, timestamp collisions and unordered receipts', () => {
  const late = event(1, 5000, 2000);
  const future = event(2, 3000, 6000);
  const collision = event(3, 6000);
  const first = event(4, 1000);
  const events = [future, first, late, collision];
  assert.equal(replayEventTime(late), 5000);
  assert.equal(replayEventTime(future), 6000);
  assert.equal(stepReplayEvent(events, 1000, -1), null);
  assert.equal(stepReplayEvent(events, 2000, 1), 5000);
  assert.equal(stepReplayEvent(events, 5000, 1), 6000);
  assert.equal(stepReplayEvent(events, 6000, -1), 5000);
  assert.equal(stepReplayEvent(events, 6000, 1), null);
});

test('historical loading, failed fetches and out-of-order replies never substitute live or another instant', () => {
  const live = bundle(11000);
  const past = bundle(5000);
  assert.equal(selectReplayBundle(null, live, past), live);
  assert.equal(selectReplayBundle(5000, live, null), null);
  assert.equal(selectReplayBundle(6000, live, past), null);
  assert.equal(selectReplayBundle(5000, live, past), past);
  const unavailable = { ...bundle(6000), state: null, frame: null };
  assert.equal(selectReplayBundle(6000, live, unavailable)?.state, null);
  assert.equal(selectReplayBundle(5000, live, unavailable), null);
});
