import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppState, CloudSettings } from '../shared/types';
import { freshWorkspaceState } from '../src/lib/store';
import { beginWorkspaceStartup } from '../src/lib/workspace-startup';

const settings: CloudSettings = { endpoint: '', configured: false, connected: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function observer() {
  let state: AppState | null = null;
  let writable = false;
  let workspaceFailures = 0;
  let connectionFailures = 0;
  let connection: CloudSettings | undefined;
  return {
    callbacks: {
      workspaceLoaded: (saved: AppState | null) => {
        state = saved;
        writable = true;
      },
      workspaceFailed: () => workspaceFailures++,
      connectionLoaded: (value: CloudSettings) => {
        connection = value;
      },
      connectionFailed: () => connectionFailures++,
    },
    snapshot: () => ({ state, writable, workspaceFailures, connectionFailures, connection }),
  };
}

test('an AI connection failure cannot discard a successfully loaded office', async () => {
  const saved = { ...freshWorkspaceState(), goal: 'Keep my saved office' };
  const result = observer();
  await beginWorkspaceStartup(
    {
      loadState: async () => saved,
      getCloudSettings: async () => {
        throw new Error('Authentication unavailable');
      },
    },
    result.callbacks,
  ).settled;
  assert.deepEqual(result.snapshot(), {
    state: saved,
    writable: true,
    workspaceFailures: 0,
    connectionFailures: 1,
    connection: undefined,
  });
});

test('the saved office is published while the AI connection check is still pending', async () => {
  const saved = freshWorkspaceState();
  const connection = deferred<CloudSettings>();
  const result = observer();
  const startup = beginWorkspaceStartup(
    { loadState: async () => saved, getCloudSettings: () => connection.promise },
    result.callbacks,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(result.snapshot().state, saved);
  assert.equal(result.snapshot().writable, true);
  assert.equal(result.snapshot().connection, undefined);
  connection.resolve(settings);
  await startup.settled;
});

test('a failed or malformed workspace never enables persistence, even when AI settings load', async () => {
  for (const loadState of [
    async () => {
      throw new Error('Disk unavailable');
    },
    async () => ({ goal: 'Malformed data' }) as AppState,
  ]) {
    const result = observer();
    await beginWorkspaceStartup({ loadState, getCloudSettings: async () => settings }, result.callbacks)
      .settled;
    assert.deepEqual(result.snapshot(), {
      state: null,
      writable: false,
      workspaceFailures: 1,
      connectionFailures: 0,
      connection: settings,
    });
  }
});

test('an explicitly empty native store can initialize a workspace', async () => {
  const result = observer();
  await beginWorkspaceStartup(
    { loadState: async () => null, getCloudSettings: async () => settings },
    result.callbacks,
  ).settled;
  assert.equal(result.snapshot().writable, true);
  assert.equal(result.snapshot().workspaceFailures, 0);
});

test('a discarded workspace mount ignores late data and connection responses', async () => {
  const workspace = deferred<AppState | null>();
  const connection = deferred<CloudSettings>();
  const result = observer();
  const startup = beginWorkspaceStartup(
    { loadState: () => workspace.promise, getCloudSettings: () => connection.promise },
    result.callbacks,
  );
  startup.cancel();
  workspace.resolve(freshWorkspaceState());
  connection.resolve(settings);
  await startup.settled;
  assert.deepEqual(result.snapshot(), {
    state: null,
    writable: false,
    workspaceFailures: 0,
    connectionFailures: 0,
    connection: undefined,
  });
});
