import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { agentsClient } from '../lib/server/agents';
import { healthServer } from '../services/worker/health';
import { createRuntime } from '../services/worker/state';

it('starts the worker without an Agents key and reports what is missing', async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.MCP_GATEWAY_URL;
  // The client is built on first use, so the process starts and a missing key becomes the failure
  // reason on one job rather than a crash loop the deployment never recovers from.
  const runtime = createRuntime(agentsClient, () => true);
  expect(() => runtime.api).toThrow('OPENAI_API_KEY is not configured');

  runtime.queue = { pendingJobs: 3, activeTasks: 1, failedJobs: 2, uncertainTasks: 1, wakeRevision: 7 };
  const server = healthServer(runtime, 0);
  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      service: 'worker',
      missingConfig: ['OPENAI_API_KEY', 'MCP_GATEWAY_URL'],
      pendingJobs: 3,
      failedJobs: 2,
      uncertainTasks: 1,
    });
  } finally {
    server.close();
  }
});
