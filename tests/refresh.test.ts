import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRefresh } from '../desktop/refresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('ordinary polls share one promise and do not schedule another action', async () => {
  const release = deferred<void>();
  const started = deferred<void>();
  let calls = 0;
  const refresh = createRefresh(
    async () => {
      calls++;
      started.resolve();
      await release.promise;
    },
    (error) => {
      throw error;
    },
  );
  const first = refresh();
  assert.equal(refresh(), first);
  await started.promise;
  assert.equal(refresh(), first);
  release.resolve();
  await first;
  assert.equal(calls, 1);
  await refresh();
  assert.equal(calls, 2);
});

test('a burst of completion notifications retains exactly one follow-up and never overlaps actions', async () => {
  const releases = [deferred<void>(), deferred<void>()];
  const starts = [deferred<void>(), deferred<void>()];
  let calls = 0;
  let running = 0;
  let settled = false;
  const refresh = createRefresh(
    async () => {
      assert.equal(running, 0);
      running++;
      const index = calls++;
      starts[index].resolve();
      await releases[index].promise;
      running--;
    },
    (error) => {
      throw error;
    },
  );
  const first = refresh();
  void first.then(() => {
    settled = true;
  });
  await starts[0].promise;
  assert.equal(refresh(true), first);
  assert.equal(refresh(true), first);
  assert.equal(refresh(), first);
  releases[0].resolve();
  await starts[1].promise;
  assert.equal(settled, false, 'The shared promise includes the retained follow-up.');
  assert.equal(refresh(), first);
  releases[1].resolve();
  await first;
  assert.equal(calls, 2);
  assert.equal(running, 0);
});

test('a completion arriving before a queued action begins still retains its follow-up', async () => {
  let calls = 0;
  const refresh = createRefresh(
    () => {
      calls++;
    },
    () => {},
  );
  const first = refresh();
  assert.equal(refresh(true), first);
  await first;
  assert.equal(calls, 2);
});

test('completion notifications received during a follow-up retain one subsequent run', async () => {
  const releases = [deferred<void>(), deferred<void>(), deferred<void>()];
  const starts = [deferred<void>(), deferred<void>(), deferred<void>()];
  let calls = 0;
  const refresh = createRefresh(
    async () => {
      const index = calls++;
      starts[index].resolve();
      await releases[index].promise;
    },
    () => {},
  );
  const first = refresh();
  await starts[0].promise;
  refresh(true);
  releases[0].resolve();
  await starts[1].promise;
  refresh(true);
  refresh(true);
  releases[1].resolve();
  await starts[2].promise;
  releases[2].resolve();
  await first;
  assert.equal(calls, 3);
});

test('a failed action reports its error and retains notifications while reporting asynchronously', async () => {
  const reporting = deferred<void>();
  const releaseReport = deferred<void>();
  const failure = new Error('Temporary read failure');
  const errors: unknown[] = [];
  let calls = 0;
  const refresh = createRefresh(
    async () => {
      if (++calls === 1) throw failure;
    },
    async (error) => {
      errors.push(error);
      reporting.resolve();
      await releaseReport.promise;
    },
  );
  const first = refresh();
  await reporting.promise;
  assert.equal(refresh(true), first);
  assert.equal(refresh(), first);
  releaseReport.resolve();
  await first;
  assert.deepEqual(errors, [failure]);
  assert.equal(calls, 2);
});

test('an error reporter failure cannot strand a requested follow-up or future polling', async () => {
  const failure = new Error('Action failed');
  let calls = 0;
  let reports = 0;
  const refresh = createRefresh(
    () => {
      if (++calls === 1) throw failure;
    },
    async (error) => {
      assert.equal(error, failure);
      reports++;
      throw new Error('Window already closed');
    },
  );
  const first = refresh();
  refresh(true);
  await first;
  assert.equal(calls, 2);
  assert.equal(reports, 1);
  await refresh();
  assert.equal(calls, 3);
});

test('ordinary polls during an error do not create a retry loop', async () => {
  let calls = 0;
  let reports = 0;
  const refresh = createRefresh(
    () => {
      calls++;
      throw new Error('Unavailable');
    },
    () => {
      reports++;
    },
  );
  const first = refresh();
  refresh();
  refresh();
  await first;
  assert.equal(calls, 1);
  assert.equal(reports, 1);
  await refresh();
  assert.equal(calls, 2);
  assert.equal(reports, 2);
});

test('notifications around promise settlement cannot disappear in a cleanup gap', async () => {
  let calls = 0;
  let running = 0;
  let refresh!: ReturnType<typeof createRefresh>;
  refresh = createRefresh(
    async () => {
      assert.equal(running++, 0);
      if (++calls === 1) {
        // Queue a completion across the action's resolution boundary.
        void Promise.resolve()
          .then(() => Promise.resolve())
          .then(() => {
            void refresh(true);
          });
      }
      running--;
    },
    () => {},
  );
  await refresh();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(running, 0);
});
