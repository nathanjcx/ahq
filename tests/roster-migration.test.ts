import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadDesktopWorkspace } from '../desktop/roster-migration';
import { SnapshotStore } from '../runtime/store';
import { StateSchema } from '../shared/schemas';
import { defaultEmployees, freshWorkspaceState, sampleState } from '../src/lib/store';

test('an existing v1 migration preserves employees and active work across loads and database reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-roster-v1-'));
  let database = await SnapshotStore.open(directory);
  try {
    const state = StateSchema.parse({
      ...sampleState(),
      demo: false,
      employees: defaultEmployees().map((employee, i) => ({
        ...employee,
        name: ['Avery', 'Parker', 'Cameron'][i],
        sessionId: `existing-session-${i}`,
      })),
      roadmap: {
        id: randomUUID(),
        goal: 'Preserve this active roadmap',
        status: 'active',
        message: 'Work is underway',
        createdAt: new Date().toISOString(),
        milestoneIds: ['c1'],
        assignments: [{ commitmentId: 'c1', employeeId: 'software-engineer', status: 'assigned' }],
      },
    });
    await database.saveHQ(state, 'Existing user workspace');
    await database.put('default-roster-v1', true);
    const history = database.history();
    const loaded = await Promise.all([loadDesktopWorkspace(database), loadDesktopWorkspace(database)]);
    for (const workspace of loaded) assert.deepEqual(workspace, state);
    assert.equal(database.get('default-roster-v2'), true);
    assert.deepEqual(database.history(), history);

    database.close();
    database = await SnapshotStore.open(directory);
    assert.deepEqual(await loadDesktopWorkspace(database), state);
    assert.deepEqual(database.history(), history);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a first default-roster migration writes v2 once and does not repeat after reopening', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-roster-first-'));
  let database = await SnapshotStore.open(directory);
  try {
    await database.saveHQ(freshWorkspaceState(), 'Legacy workspace');
    const results = await Promise.all([loadDesktopWorkspace(database), loadDesktopWorkspace(database)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(database.get('default-roster-v2'), true);
    assert.equal(
      database.history().filter((entry) => entry.reason === 'Replaced the default employee roster').length,
      1,
    );
    database.close();
    database = await SnapshotStore.open(directory);
    assert.deepEqual(await loadDesktopWorkspace(database), results[0]);
    assert.equal(database.history().length, 2);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a custom roster is marked migrated without replacing its workspace', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ahq-roster-custom-'));
  const database = await SnapshotStore.open(directory);
  try {
    const state = StateSchema.parse(sampleState());
    await database.saveHQ(state);
    assert.deepEqual(await loadDesktopWorkspace(database), state);
    assert.equal(database.get('default-roster-v2'), true);
    assert.equal(database.history().length, 1);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
