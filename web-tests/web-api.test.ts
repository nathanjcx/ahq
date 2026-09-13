import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { WebApiError, webClient } from '../lib/api/client';
import { REQUESTED_WITH } from '../lib/api/routes';
import { actor, failure, HttpError, jsonError, jsonOk, parseBody } from '../lib/server/http';
import { resetRateLimits, withinRateLimit } from '../lib/server/rate-limit';

const appUrl = 'https://hq.example.com';

/** The sealed AuthKit session a route reads through `withAuth()`, without a WorkOS environment. */
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: async () => ({ user: { id: 'caller', name: 'Caller', email: 'caller@example.com' } }),
  getWorkOS: () => {
    throw new Error('The WorkOS API is not reachable in tests');
  },
}));

function post(headers: Record<string, string>, body = '{}') {
  return new Request(`${appUrl}/api/integrations/connect`, { method: 'POST', headers, body });
}

beforeEach(() => {
  process.env.APP_URL = appUrl;
  process.env.WORKOS_CLIENT_ID = 'client_test';
  process.env.WORKOS_API_KEY = 'sk_test_key';
  process.env.WORKOS_COOKIE_PASSWORD = 'a'.repeat(32);
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = `${appUrl}/callback`;
  resetRateLimits();
  vi.unstubAllGlobals();
});

describe('route guards', () => {
  it('refuses a state-changing request that cannot prove it came from this application', async () => {
    const rejected = [
      post({}),
      post({ origin: appUrl }),
      post({ [REQUESTED_WITH.header]: REQUESTED_WITH.value }),
      post({ origin: 'https://evil.example.com', [REQUESTED_WITH.header]: REQUESTED_WITH.value }),
    ];
    for (const request of rejected) {
      await expect(actor(request)).rejects.toMatchObject({ status: 403, code: 'bad_origin' });
    }
  });

  it('answers every failure with the same envelope and never caches it', async () => {
    const response = failure(new HttpError(404, 'Connection not found.', 'not_found'));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Connection not found.', code: 'not_found' });
    expect(await failure(new Error('Bearer abc123 failed')).json()).toEqual({
      error: 'Bearer [redacted] failed',
    });
    expect(jsonError(429, 'Slow down.').status).toBe(429);
    expect(jsonOk({ saved: true }).headers.get('cache-control')).toBe('no-store');
  });

  it('turns an unparseable or invalid body into one stable 400', async () => {
    const schema = z.object({ provider: z.string() });
    const body = (text: string) => new Request(`${appUrl}/x`, { method: 'POST', body: text });
    await expect(parseBody(body('not json'), schema)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    await expect(parseBody(body('{"provider":1}'), schema)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    expect(await parseBody(body('{"provider":"linear"}'), schema)).toEqual({ provider: 'linear' });
  });
});

describe('per-instance rate limiting', () => {
  it('allows the configured burst and refuses the rest until the window rolls over', () => {
    for (let attempt = 0; attempt < 10; attempt++) expect(withinRateLimit('reveal:one', 10)).toBe(true);
    expect(withinRateLimit('reveal:one', 10)).toBe(false);
    expect(withinRateLimit('reveal:two', 10)).toBe(true);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      expect(withinRateLimit('reveal:one', 10)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays bounded when an unauthenticated caller floods it with fresh keys', () => {
    // Keys come from headers and path segments, so a flood of distinct ones must not grow the map
    // without end. Past the cap the oldest live window is dropped, which is what makes room here.
    for (let key = 0; key <= 10_000; key++) expect(withinRateLimit(`flood:${key}`, 1)).toBe(true);
    expect(withinRateLimit('flood:0', 1)).toBe(true);
    expect(withinRateLimit('flood:10000', 1)).toBe(false);
  });
});

describe('typed web client', () => {
  it('sends the application header and raises the error envelope as a typed failure', async () => {
    const fetchMock = vi.fn(async (_path: string, _init: RequestInit) =>
      Response.json({ error: 'Sign in to continue.', code: 'unauthenticated' }, { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const failed = await webClient.connect({ provider: 'linear' }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(WebApiError);
    expect(failed).toMatchObject({ status: 401, code: 'unauthenticated', message: 'Sign in to continue.' });
    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Record<string, string>)[REQUESTED_WITH.header]).toBe(REQUESTED_WITH.value);
    expect(init.credentials).toBe('same-origin');
  });

  it('refuses a response that does not match the route schema', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ authorizationUrl: 42 }));
    await expect(webClient.connect({ provider: 'linear' })).rejects.toThrow(
      'The server returned an unexpected response.',
    );
  });

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ url: 'https://hq/relay', secret: 's3cret' }));
    expect(await webClient.relaySecret.reveal('conn_1')).toEqual({
      url: 'https://hq/relay',
      secret: 's3cret',
    });
  });
});

describe('provider setup', () => {
  it('lets a provider that registers its own client connect without an administrator entry', async () => {
    const { providerSetup } = await import('../components/integrations/connect');
    const { getProvider } = await import('../lib/providers');
    const readiness = (provider: 'linear' | 'github', enabledUrls: string[]) => [
      { provider, enabledUrls, oauthUrls: [], reviewedTools: 3, inboxConfigured: false },
    ];
    const linear = getProvider('linear');
    expect(providerSetup(linear, readiness('linear', [linear.serverUrl])).connectable).toEqual([
      linear.serverUrl,
    ]);
    expect(providerSetup(linear, readiness('linear', [])).missing).toContain(
      'Enable its server URL on the Operations page.',
    );
    const github = getProvider('github');
    const setup = providerSetup(github, readiness('github', [github.serverUrl]));
    expect(setup.connectable).toEqual([]);
    expect(setup.missing).toContain('Add its OAuth client on the Operations page.');
  });
});
