import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOUR_ARTIFACTS,
  TOUR_DURATION,
  TOUR_FORECAST,
  TOUR_GOAL,
  TOUR_PHASES,
  tourFrame,
  tourTime,
  tourTyping,
} from '../src/components/demo-tour-model';

test('product launch tour stays under 30 seconds and completes deterministically at 28 seconds', () => {
  assert.equal(TOUR_DURATION, 28_000);
  assert.ok(TOUR_DURATION < 30_000);
  assert.equal(TOUR_GOAL, 'Astra HQ Product Launch');
  assert.equal(tourFrame(-1).elapsed, 0);
  assert.equal(tourFrame(Number.NaN).elapsed, 0);
  assert.equal(tourFrame(TOUR_DURATION - 1).complete, false);
  const complete = tourFrame(TOUR_DURATION);
  assert.equal(complete.phase.id, 'done');
  assert.equal(complete.complete, true);
  assert.deepEqual(tourFrame(120_000), complete);
  assert.equal(complete.files.length, 7);
  assert.ok(
    complete.internHired && complete.emailApproved && complete.prApproved && complete.campaignApproved,
  );
});

test('scripted actions precede their results and every file stays available once created', () => {
  assert.equal(tourFrame(tourTime(5500) - 1).internHired, false);
  assert.equal(tourFrame(tourTime(5500)).internHired, true);
  assert.equal(tourFrame(tourTime(26_000) - 1).emailApproved, false);
  assert.equal(tourFrame(tourTime(26_000)).emailApproved, true);
  assert.equal(tourFrame(tourTime(36_000) - 1).prApproved, false);
  assert.equal(tourFrame(tourTime(36_000)).prApproved, true);
  assert.equal(tourFrame(tourTime(58_000) - 1).campaignApproved, false);
  assert.equal(tourFrame(tourTime(58_000)).campaignApproved, true);
  for (const file of TOUR_ARTIFACTS) {
    assert.ok(!tourFrame(file.at - 1).files.some((item) => item.id === file.id));
    assert.ok(tourFrame(file.at).files.some((item) => item.id === file.id));
    assert.ok(tourFrame(TOUR_DURATION).files.some((item) => item.id === file.id));
  }
});

test('the cursor visits user setup controls before creation and emits bounded click pulses', () => {
  assert.equal(tourFrame(0).target, 'employees-nav');
  assert.equal(tourFrame(tourTime(900)).target, 'new-employee');
  assert.equal(tourFrame(tourTime(1600)).target, 'hire-name');
  assert.equal(tourFrame(tourTime(3000)).target, 'hire-role');
  assert.equal(tourFrame(tourTime(5300)).target, 'hire-create');
  assert.equal(tourFrame(tourTime(5300) - 1).clicking, false);
  assert.equal(tourFrame(tourTime(5300)).clicking, true);
  assert.equal(tourFrame(tourTime(5300) + 280).clicking, false);
  assert.equal(tourFrame(TOUR_DURATION).clicking, false);
  for (let index = 1; index < TOUR_PHASES.length; index++) {
    assert.ok(TOUR_PHASES[index].at > TOUR_PHASES[index - 1].at);
    assert.equal(tourFrame(TOUR_PHASES[index].at).phase.id, TOUR_PHASES[index].id);
  }
});

test('typed inputs are empty before their slot and complete by its end', () => {
  assert.equal(tourTyping(TOUR_GOAL, 500, 1000, 2000), '');
  assert.equal(tourTyping(TOUR_GOAL, 1500, 1000, 2000), TOUR_GOAL.slice(0, Math.floor(TOUR_GOAL.length / 2)));
  assert.equal(tourTyping(TOUR_GOAL, 2000, 1000, 2000), TOUR_GOAL);
  assert.equal(tourTyping(TOUR_GOAL, 5000, 1000, 2000), TOUR_GOAL);
});

test('story-time mapping keeps every phase ordered while scaling a minute into 28 seconds', () => {
  assert.equal(tourTime(0), 0);
  assert.equal(tourTime(30_000), 14_000);
  assert.equal(tourTime(60_000), TOUR_DURATION);
  assert.ok(TOUR_PHASES.every((phase) => phase.at <= TOUR_DURATION));
  assert.ok(TOUR_ARTIFACTS.every((file) => file.at < 30_000));
});

test('sample forecast uses the same monthly price and profit arithmetic in every row', () => {
  for (const row of TOUR_FORECAST) {
    assert.equal(row.revenue, row.customers * 29);
    assert.equal(row.profit, row.revenue - row.costs);
  }
  assert.equal(
    TOUR_FORECAST.reduce((total, row) => total + row.revenue, 0),
    24_650,
  );
  assert.equal(
    TOUR_FORECAST.reduce((total, row) => total + row.costs, 0),
    7800,
  );
  assert.equal(
    TOUR_FORECAST.reduce((total, row) => total + row.profit, 0),
    16_850,
  );
});
