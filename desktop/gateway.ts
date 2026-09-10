import { SessionSchema } from '../shared/schemas';
import { z } from 'zod';
export function validateEndpoint(input: string) {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Use a gateway base URL without credentials, query parameters, or fragments.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('Your gateway must use HTTPS. Localhost is allowed for development.');
  return url.toString().replace(/\/$/, '');
}
export async function gatewayRequest(
  endpoint: string,
  token: string,
  route: string,
  body?: unknown,
  idempotencyKey?: string,
) {
  const response = await fetch(`${validateEndpoint(endpoint)}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error('The gateway did not accept your access token. Check the token and its permissions.');
    if (response.status === 409)
      throw new Error(
        'This draft changed after you opened it. Wait for the latest version and review again.',
      );
    throw new Error(`The Astra gateway returned ${response.status}. No local approval has been recorded.`);
  }
  if (Number(response.headers.get('content-length')) > 2_000_000)
    throw new Error('The gateway response is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The gateway returned an empty response.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error('The gateway response is too large.');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function checkGateway(endpoint: string, token: string) {
  const health = z
    .object({ service: z.literal('astra-hq-gateway'), version: z.literal(1) })
    .parse(await gatewayRequest(endpoint, token, '/v1/health'));
  return health;
}
export async function readSession(endpoint: string, token: string, id: string) {
  return SessionSchema.parse(await gatewayRequest(endpoint, token, `/v1/sessions/${encodeURIComponent(id)}`));
}
