import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as networkFetch } from 'undici';
import ipaddr from 'ipaddr.js';
import { getProvider } from '../providers';
export function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}
/**
 * Test-only escape hatch. The runtime harness in `web-tests/` runs a fake MCP server on loopback
 * HTTP, which every production rule below correctly rejects. It is honoured only when the process
 * is a test process and opts in explicitly, so production keeps HTTPS, the provider registry, and
 * the public-address rule.
 */
function loopbackTestEndpoint(url: URL): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.ALLOW_INSECURE_MCP_FOR_TESTS === '1' &&
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
  );
}

export function approvedMcpUrl(providerId: string, raw: string): URL {
  const provider = getProvider(providerId);
  const url = new URL(raw || provider.serverUrl);
  if (loopbackTestEndpoint(url)) return url;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new Error('MCP servers must use HTTPS without embedded credentials or custom ports');
  const official = [provider.serverUrl, ...(provider.products?.map((p) => p.url) || [])];
  if (!official.includes(url.toString()) && !official.includes(raw))
    throw new Error('This MCP endpoint is not in the provider registry.');
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')))
    throw new Error('MCP endpoints must use an approved DNS hostname');
  return url;
}
const dispatcher = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, '', 4);
        if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
          return callback(new Error('Private and reserved network destinations are blocked'), '', 4);
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
export async function safeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const loopbackTest = loopbackTestEndpoint(url);
  if (
    !loopbackTest &&
    (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname.replace(/^\[|\]$/g, '')))
  )
    throw new Error('Unsafe integration destination');
  const response = await networkFetch(url, {
    ...init,
    redirect: 'manual',
    ...(loopbackTest ? {} : { dispatcher }),
    signal: init?.signal || AbortSignal.timeout(30000),
  } as Parameters<typeof networkFetch>[1]);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('Integration redirects must be registered explicitly');
  }
  return response as unknown as Response;
}
