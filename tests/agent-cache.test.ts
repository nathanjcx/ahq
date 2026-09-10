import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  getLocalStateRecovery,
  initialState,
  readLocalState,
  recoverLocalState,
  saveLocalState,
} from '../src/lib/store';

function withCache(
  run: (cache: {
    entries: Map<string, string>;
    failReads: boolean;
    failWrites: boolean;
    failPrimaryWrite: boolean;
  }) => void,
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const cache = {
    entries: new Map<string, string>(),
    failReads: false,
    failWrites: false,
    failPrimaryWrite: false,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        if (cache.failReads) throw new Error('Storage access denied');
        return cache.entries.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (cache.failWrites || (cache.failPrimaryWrite && key === STORAGE_KEY))
          throw new Error('Storage quota reached');
        cache.entries.set(key, value);
      },
    },
  });
  readLocalState();
  try {
    run(cache);
  } finally {
    cache.failReads = false;
    cache.failWrites = false;
    cache.failPrimaryWrite = false;
    cache.entries.clear();
    readLocalState();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

test('a valid legacy cache keeps the workspace and injects independent employee configuration', () =>
  withCache(({ entries }) => {
    const legacy = initialState();
    legacy.workspaceName = 'The existing workspace';
    legacy.employees.forEach((employee) => {
      delete employee.agent;
    });
    entries.set(STORAGE_KEY, JSON.stringify(legacy));
    const loaded = readLocalState();
    assert.equal(loaded.workspaceName, legacy.workspaceName);
    assert.deepEqual(loaded.messages, legacy.messages);
    assert.equal(loaded.employees[0].agent?.model, 'gpt-6-astra');
    loaded.employees[0].agent!.memory.kinds.length = 0;
    assert.equal(loaded.employees[1].agent!.memory.kinds.length, 5);
    assert.equal(getLocalStateRecovery(), null);
    assert.equal(entries.size, 1);
  }));

test('invalid JSON preserves the original and a verified backup while blocking sample autosave', () =>
  withCache(({ entries }) => {
    const raw = '{"workspaceName":"Important unfinished work", broken';
    entries.set(STORAGE_KEY, raw);
    assert.equal(readLocalState().demo, true);
    const recovery = getLocalStateRecovery();
    assert.ok(recovery?.backupKey);
    assert.equal(entries.get(recovery.backupKey), raw);
    assert.equal(entries.get(STORAGE_KEY), raw);
    assert.throws(() => saveLocalState(initialState()), /paused/);
    readLocalState();
    assert.equal(entries.size, 2, 'a repeated initialization reuses the verified backup');
    assert.equal(entries.get(STORAGE_KEY), raw);
  }));

test('a non-Astra saved config triggers preservation rather than silent model replacement', () =>
  withCache(({ entries }) => {
    const saved = initialState();
    const raw = JSON.stringify(saved).replace('"model":"gpt-6-astra"', '"model":"another-model"');
    entries.set(STORAGE_KEY, raw);
    readLocalState();
    assert.ok(getLocalStateRecovery());
    assert.equal(entries.get(STORAGE_KEY), raw);
    assert.throws(() => saveLocalState(saved), /paused/);
  }));

test('recovery validates the replacement and retains the invalid source after saving resumes', () =>
  withCache(({ entries }) => {
    const raw = 'not JSON';
    entries.set(STORAGE_KEY, raw);
    readLocalState();
    const backup = getLocalStateRecovery()!.backupKey!;
    const valid = initialState();
    valid.workspaceName = 'Recovered desktop source';
    assert.throws(() => recoverLocalState({ ...valid, schemaVersion: 2 } as unknown as typeof valid));
    assert.equal(entries.get(STORAGE_KEY), raw);
    const recovered = recoverLocalState(valid);
    assert.equal(getLocalStateRecovery(), null);
    assert.equal(recovered.workspaceName, valid.workspaceName);
    assert.equal(entries.get(backup), raw);
    assert.equal(JSON.parse(entries.get(STORAGE_KEY)!).workspaceName, valid.workspaceName);
    saveLocalState({ ...valid, goal: 'Continue recovered work' });
    assert.equal(JSON.parse(entries.get(STORAGE_KEY)!).goal, 'Continue recovered work');
  }));

test('a full cache prevents destructive recovery and can be retried after space is available', () =>
  withCache((cache) => {
    const raw = 'keep this invalid source';
    cache.entries.set(STORAGE_KEY, raw);
    cache.failWrites = true;
    readLocalState();
    assert.equal(getLocalStateRecovery()?.backupKey, undefined);
    assert.throws(() => recoverLocalState(initialState()), /backed up/);
    assert.equal(cache.entries.get(STORAGE_KEY), raw);
    cache.failWrites = false;
    recoverLocalState(initialState());
    assert.equal(getLocalStateRecovery(), null);
    assert.ok([...cache.entries.entries()].some(([key, value]) => key !== STORAGE_KEY && value === raw));
  }));

test('recovery also preserves a newer cache written by another window', () =>
  withCache(({ entries }) => {
    entries.set(STORAGE_KEY, 'first invalid source');
    readLocalState();
    const firstBackup = getLocalStateRecovery()!.backupKey!;
    entries.set(STORAGE_KEY, 'newer source from another window');
    recoverLocalState(initialState());
    assert.equal(entries.get(firstBackup), 'first invalid source');
    assert.ok(
      [...entries.entries()].some(
        ([key, value]) => key !== STORAGE_KEY && value === 'newer source from another window',
      ),
    );
  }));

test('a failed replacement write keeps recovery pending and preserves its source', () =>
  withCache((cache) => {
    const raw = 'invalid source';
    cache.entries.set(STORAGE_KEY, raw);
    readLocalState();
    cache.failPrimaryWrite = true;
    assert.throws(() => recoverLocalState(initialState()), /quota/);
    assert.ok(getLocalStateRecovery());
    assert.equal(cache.entries.get(STORAGE_KEY), raw);
    assert.throws(() => saveLocalState(initialState()), /paused/);
  }));

test('inaccessible browser storage pauses saving until its original source can be preserved', () =>
  withCache((cache) => {
    cache.entries.set(STORAGE_KEY, 'unreadable source');
    cache.failReads = true;
    readLocalState();
    assert.match(getLocalStateRecovery()!.message, /could not be read/);
    assert.throws(() => saveLocalState(initialState()), /paused/);
    cache.failReads = false;
    recoverLocalState(initialState());
    assert.equal(getLocalStateRecovery(), null);
    assert.ok(
      [...cache.entries.entries()].some(
        ([key, value]) => key !== STORAGE_KEY && value === 'unreadable source',
      ),
    );
  }));
