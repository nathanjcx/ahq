import { expect, it } from 'vitest';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { harness, identity, publishEmployee, secret, type Harness } from './support';

const subject = 'lease-user';

/** A task a worker may monitor: it has a session and no input job in flight. */
async function monitorableTask(t: Harness) {
  const user = t.withIdentity(identity(subject));
  await user.mutation(api.workspace.bootstrap, { name: 'Acme' });
  const { versionId } = await publishEmployee(t);
  const { employeeId } = await user.mutation(api.marketplace.hire, { versionId });
  const { taskId } = await user.mutation(api.tasks.create, {
    employeeId,
    title: 'Watch me',
    prompt: 'Start working.',
  });
  const [start] = await t.mutation(api.services.queue.claimJobs, {
    secret,
    workerId: 'setup',
    limit: 1,
  });
  await t.mutation(api.services.sessions.recordSession, { secret, taskId, sessionId: 'session-1' });
  await t.mutation(api.services.queue.completeJob, {
    secret,
    jobId: start.id,
    leaseToken: start.leaseToken,
  });
  return taskId;
}

const claim = (t: Harness, workerId: string, limit = 4) =>
  t.mutation(api.services.queue.claimStreams, { secret, workerId, limit });

async function streamOwner(t: Harness, taskId: Id<'tasks'>) {
  return (await t.run(async (ctx) => ctx.db.get(taskId)))?.streamOwner;
}

it('lets only one worker monitor a session at a time', async () => {
  const t = harness();
  const taskId = await monitorableTask(t);
  expect(await claim(t, 'worker-a')).toEqual([{ taskId, leaseExpiresAt: expect.any(Number) }]);
  expect(await claim(t, 'worker-b')).toEqual([]);
  expect(await streamOwner(t, taskId)).toBe('worker-a');
  // The owner reclaims its own session, which is how a restarted monitor picks it back up.
  expect(await claim(t, 'worker-a')).toEqual([{ taskId, leaseExpiresAt: expect.any(Number) }]);
});

it('hands a session over when the lease expires', async () => {
  const t = harness();
  const taskId = await monitorableTask(t);
  await claim(t, 'worker-a');
  await t.run(async (ctx) => ctx.db.patch(taskId, { streamLeaseExpiresAt: Date.now() - 1 }));
  expect(await claim(t, 'worker-b')).toEqual([{ taskId, leaseExpiresAt: expect.any(Number) }]);
  expect(await streamOwner(t, taskId)).toBe('worker-b');
  expect(await t.mutation(api.services.queue.renewStream, { secret, taskId, workerId: 'worker-a' })).toEqual({
    claimed: false,
    leaseExpiresAt: expect.any(Number),
  });
});

it('releases a lease on shutdown and keeps it for its owner otherwise', async () => {
  const t = harness();
  const taskId = await monitorableTask(t);
  await claim(t, 'worker-a');
  expect(
    await t.mutation(api.services.queue.releaseStream, { secret, taskId, workerId: 'worker-b' }),
  ).toEqual({ released: false });
  expect(
    await t.mutation(api.services.queue.releaseStream, { secret, taskId, workerId: 'worker-a' }),
  ).toEqual({ released: true });
  expect(await streamOwner(t, taskId)).toBeUndefined();
  expect(await claim(t, 'worker-b')).toEqual([{ taskId, leaseExpiresAt: expect.any(Number) }]);
});

it('claims nothing when a worker has no free slots', async () => {
  const t = harness();
  const taskId = await monitorableTask(t);
  expect(await claim(t, 'worker-a', 0)).toEqual([]);
  expect(await t.mutation(api.services.queue.claimJobs, { secret, workerId: 'worker-a', limit: 0 })).toEqual(
    [],
  );
  expect(await streamOwner(t, taskId)).toBeUndefined();
});
