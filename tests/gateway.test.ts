import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkGateway, gatewayRequest, readSession, validateEndpoint } from '../desktop/gateway';

async function fixture(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
test('gateway endpoints require HTTPS except for explicit loopback development', () => {
  assert.equal(validateEndpoint('https://astra.example.com/'), 'https://astra.example.com');
  assert.equal(validateEndpoint('http://127.0.0.1:4500'), 'http://127.0.0.1:4500');
  assert.throws(() => validateEndpoint('http://service.example.com'), /HTTPS/);
  assert.throws(() => validateEndpoint('https://name:secret@astra.example.com'), /credentials/);
  assert.throws(() => validateEndpoint('https://astra.example.com?token=x'), /query/);
});
test('connection verifies the gateway protocol and carries credentials only in the header', async () => {
  const service = await fixture((req, res) => {
    assert.equal(req.url, '/v1/health');
    assert.equal(req.headers.authorization, 'Bearer test-only-token');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ service: 'astra-hq-gateway', version: 1 }));
  });
  try {
    assert.deepEqual(await checkGateway(service.url, 'test-only-token'), {
      service: 'astra-hq-gateway',
      version: 1,
    });
  } finally {
    await service.close();
  }
});
test('retries preserve the caller’s idempotency key', async () => {
  const keys: string[] = [];
  const service = await fixture((req, res) => {
    keys.push(String(req.headers['idempotency-key']));
    res.end('{}');
  });
  try {
    await gatewayRequest(
      service.url,
      'test-token',
      '/v1/sessions',
      { assignment: 'A test assignment' },
      'operation-1',
    );
    await gatewayRequest(
      service.url,
      'test-token',
      '/v1/sessions',
      { assignment: 'A test assignment' },
      'operation-1',
    );
    assert.deepEqual(keys, ['operation-1', 'operation-1']);
  } finally {
    await service.close();
  }
});
test('stale gateway approvals fail without a successful local decision', async () => {
  const service = await fixture((_req, res) => {
    res.writeHead(409);
    res.end('{}');
  });
  try {
    await assert.rejects(
      gatewayRequest(service.url, 'test-token', '/v1/sessions/a/decisions', { version: 1 }),
      /changed after you opened/,
    );
  } finally {
    await service.close();
  }
});
test('redirects cannot forward an access token to a different destination', async () => {
  const service = await fixture((_req, res) => {
    res.writeHead(302, { Location: 'https://example.com' });
    res.end();
  });
  try {
    await assert.rejects(checkGateway(service.url, 'test-token'));
  } finally {
    await service.close();
  }
});
test('a malformed cloud response cannot become employee activity', async () => {
  const service = await fixture((_req, res) =>
    res.end(JSON.stringify({ id: 'session-1', status: 'totally-fine' })),
  );
  try {
    await assert.rejects(readSession(service.url, 'test-token', 'session-1'));
  } finally {
    await service.close();
  }
});
