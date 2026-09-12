import { createServer, type Server } from 'node:http';
import type { WorkerRuntime } from './state';

/** Readiness is the live Convex subscription: without it the worker cannot see or claim work. */
export function healthServer(runtime: WorkerRuntime, port: number): Server {
  return createServer((_req, res) => {
    const connected = runtime.connected() && !runtime.stopping;
    res.writeHead(connected ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: connected ? 'ok' : 'connecting',
        service: 'worker',
        workerId: runtime.workerId,
        connected,
        inFlightJobs: runtime.jobSlots.total - runtime.jobSlots.free(),
        activeMonitors: runtime.monitors.size,
        freeJobSlots: runtime.jobSlots.free(),
        freeMonitorSlots: runtime.monitorSlots.free(),
        lastClaimAt: runtime.lastClaimAt,
        lastSubscriptionAt: runtime.lastSubscriptionAt,
      }),
    );
  }).listen(port, '0.0.0.0');
}
