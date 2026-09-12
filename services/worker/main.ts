import { setTimeout as delay } from 'node:timers/promises';
import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { agentsClient } from '../../lib/server/agents';
import { credentialKey, requiredEnv, safeError, serviceSecret } from '../../lib/server/secrets';
import { healthServer } from './health';
import { releaseMonitors } from './monitor';
import { pull, pullIntervalMs } from './queue';
import { createRuntime } from './state';

const drainDeadlineMs = 30_000;
const drainPollMs = 200;

// Refuse to start with a weak or missing secret rather than failing on the first claim.
const secret = serviceSecret();
credentialKey();
const database = new ConvexClient(process.env.CONVEX_URL || requiredEnv('NEXT_PUBLIC_CONVEX_URL'));
const runtime = createRuntime(
  agentsClient(),
  () => runtime.lastSubscriptionAt > 0 && database.connectionState().isWebSocketConnected,
);

// The subscription is a wake signal carrying counts only. The worker pulls its own work.
const unsubscribe = database.onUpdate(
  makeFunctionReference<'query'>('services/queue:workerState'),
  { secret },
  () => {
    runtime.lastSubscriptionAt = Date.now();
    void pull(runtime);
  },
  (error) => console.error('Queue subscription failed:', safeError(error)),
);
const pullTimer = setInterval(() => void pull(runtime), pullIntervalMs);
const health = healthServer(runtime, Number(process.env.PORT || 4002));
console.log(`Worker ${runtime.workerId} started`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Worker ${runtime.workerId} stopping on ${signal}`);
  runtime.stopping = true;
  clearInterval(pullTimer);
  unsubscribe();
  const deadline = Date.now() + drainDeadlineMs;
  while (runtime.jobSlots.free() < runtime.jobSlots.total && Date.now() < deadline) await delay(drainPollMs);
  await releaseMonitors(runtime);
  health.close();
  await database.close().catch((error) => console.error('Convex close failed:', safeError(error)));
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
