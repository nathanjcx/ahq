import { createServer, type Server } from 'node:http';
import type { WorkerRuntime } from './state';

/**
 * Variables a task needs that the process does not. The worker starts and serves health without
 * them; the jobs that need them fail with the reason, which is why `/health` names them.
 */
const TASK_CONFIG = ['OPENAI_API_KEY', 'MCP_GATEWAY_URL'];

export function missingTaskConfig(): string[] {
  return TASK_CONFIG.filter((name) => !process.env[name]);
}

/** Readiness is the live Convex subscription: without it the worker cannot see or claim work. */
export function healthServer(runtime: WorkerRuntime, port: number): Server {
  return createServer((_req, res) => {
    const connected = runtime.connected() && !runtime.stopping;
    res.writeHead(connected ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: runtime.stopping ? 'stopping' : connected ? 'ok' : 'connecting',
        service: 'worker',
        workerId: runtime.workerId,
        connected,
        missingConfig: missingTaskConfig(),
        inFlightJobs: runtime.jobSlots.total - runtime.jobSlots.free(),
        activeMonitors: runtime.monitors.size,
        freeJobSlots: runtime.jobSlots.free(),
        freeMonitorSlots: runtime.monitorSlots.free(),
        pendingJobs: runtime.queue?.pendingJobs ?? null,
        failedJobs: runtime.queue?.failedJobs ?? null,
        uncertainTasks: runtime.queue?.uncertainTasks ?? null,
        lastClaimAt: runtime.lastClaimAt,
        lastSubscriptionAt: runtime.lastSubscriptionAt,
      }),
    );
  }).listen(port, '0.0.0.0');
}
