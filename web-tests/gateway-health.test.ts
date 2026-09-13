import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import type { Backend } from '../lib/server/backend';
import { createGateway } from '../services/gateway/create';
import { harness, testBackend } from './support';

async function health(backend: Backend) {
  const server = createGateway({ backend }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

it('answers the gateway healthcheck only while Convex accepts the service secret', async () => {
  expect(await health(testBackend(harness()))).toEqual({
    status: 200,
    body: { status: 'ok', service: 'mcp-gateway' },
  });

  // What a wrong `AHQ_SERVICE_SECRET` or an unreachable deployment looks like: the process listens and
  // can authorize nothing, so the healthcheck has to fail rather than report a listening socket.
  const refused = () => Promise.reject(new Error('Service secret is invalid'));
  expect(await health({ query: refused, mutate: refused, journalMutation: refused })).toEqual({
    status: 503,
    body: { status: 'degraded', service: 'mcp-gateway' },
  });
});
