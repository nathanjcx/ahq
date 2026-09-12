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
export function approvedMcpUrl(providerId: string, raw: string): URL {
  const provider = getProvider(providerId);
  const url = new URL(raw || provider.serverUrl);
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
  if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname.replace(/^\[|\]$/g, '')))
    throw new Error('Unsafe integration destination');
  const response = await networkFetch(url, {
    ...init,
    redirect: 'manual',
    dispatcher,
    signal: init?.signal || AbortSignal.timeout(30000),
  } as Parameters<typeof networkFetch>[1]);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('Integration redirects must be registered explicitly');
  }
  return response as unknown as Response;
}
