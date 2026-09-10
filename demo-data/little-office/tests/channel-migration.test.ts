import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initialSnapshot } from '../runtime/fixtures';
import { SnapshotStore } from '../runtime/store';

test('retired channels move to supported inboxes without losing work or attachments', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'office-channels-'));
  const store = await SnapshotStore.open(directory);
  try {
    const snapshot = initialSnapshot();
    for (const [index, source] of ['discord', 'imessage'].entries()) {
      Object.assign(snapshot.sources[index], { source, externalId: `${source}-delivery-example`, threadId: `${source}:example` });
    }
    await store.save(snapshot);
    const loaded = store.load()!;
    assert.deepEqual(loaded.sources.slice(0, 2).map(item => item.source), ['slack', 'gmail']);
    assert.deepEqual(loaded.sources.slice(0, 2).map(item => item.threadId), ['slack:example', 'gmail:example']);
    assert.deepEqual(loaded.sources.slice(0, 2).map(item => item.externalId), ['slack-delivery-example', 'gmail-delivery-example']);
    assert.deepEqual(loaded.sources.map(item => [item.id, item.attachments]), snapshot.sources.map(item => [item.id, item.attachments]));
    assert.deepEqual(loaded.work, snapshot.work);
    assert.deepEqual(loaded.artifacts, snapshot.artifacts);
    await store.save(loaded);
    assert.deepEqual(store.load(), loaded);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
