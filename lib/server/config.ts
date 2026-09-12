import { query } from './backend';
import type { ProviderRuntimeConfig } from '../../services/types';

let cache: { at: number; value: ProviderRuntimeConfig[] } | undefined;

/** Provider configuration lives in Convex. Cache it briefly so one request does not refetch it. */
async function providerRuntimeConfigs(): Promise<ProviderRuntimeConfig[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = await query<ProviderRuntimeConfig[]>('services/config:providers');
  cache = { at: Date.now(), value };
  return value;
}

export async function providerRuntimeConfig(provider: string) {
  return (await providerRuntimeConfigs()).find((entry) => entry.provider === provider);
}
