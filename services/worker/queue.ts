import { mutate } from '../../lib/server/backend';
import { safeError } from '../../lib/server/secrets';
import type { Job } from '../types';
import { runJob } from './jobs';
import { startMonitor } from './monitor';
import type { WorkerRuntime } from './state';

/** Belt and braces for a missed subscription push. */
export const pullIntervalMs = 15_000;
const retryDelayMs = 5_000;

async function claimJobs(runtime: WorkerRuntime) {
  const limit = runtime.jobSlots.free();
  if (!limit) return;
  const jobs = await mutate<Job[]>('services/queue:claimJobs', {
    workerId: runtime.workerId,
    limit,
  });
  runtime.lastClaimAt = Date.now();
  if (!jobs.length) return;
  runtime.jobSlots.take(jobs.length);
  for (const job of jobs) {
    void runJob(runtime, job)
      .catch((error) => console.error('Job ended abnormally:', safeError(error)))
      .finally(() => {
        runtime.jobSlots.release(1);
        void pull(runtime);
      });
  }
  runtime.pullAgain = true;
}

async function claimStreams(runtime: WorkerRuntime) {
  const limit = runtime.monitorSlots.free();
  if (!limit) return;
  const claimed = await mutate<{ taskId: string }[]>('services/queue:claimStreams', {
    workerId: runtime.workerId,
    limit,
  });
  runtime.lastClaimAt = Date.now();
  for (const { taskId } of claimed) startMonitor(runtime, taskId);
  if (claimed.length >= limit) runtime.pullAgain = true;
}

/**
 * One claim pass for jobs and session monitors, sized by free slots so a replica never takes work it
 * cannot run. Re-entrant calls coalesce into the running pass.
 */
export async function pull(runtime: WorkerRuntime): Promise<void> {
  if (runtime.stopping) return;
  if (runtime.pulling) {
    runtime.pullAgain = true;
    return;
  }
  runtime.pulling = true;
  try {
    do {
      runtime.pullAgain = false;
      await claimJobs(runtime);
      await claimStreams(runtime);
    } while (runtime.pullAgain && !runtime.stopping);
  } catch (error) {
    console.error('Queue connection failed:', safeError(error));
    setTimeout(() => void pull(runtime), retryDelayMs);
  } finally {
    runtime.pulling = false;
  }
}
