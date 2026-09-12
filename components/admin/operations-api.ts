import type { OAuthClientConfig, ProviderConfig, ProviderId, ProviderReadiness } from '@/lib/contracts';
import { providers, type ProviderDefinition } from '@/lib/providers';
import { webClient } from '@/lib/api/client';

/** A provider delivers events by webhook exactly when it has inbox resources to follow. */
export function hasNativeInbox(provider: ProviderDefinition) {
  return Boolean(provider.inbox);
}

export type OAuthClientInput = Omit<OAuthClientConfig, 'hasClientSecret'> & { clientSecret?: string };

/** Secrets go to the web service, the only part that can seal them. The acknowledgement carries nothing. */
export async function saveOAuthClient(provider: ProviderId, client: OAuthClientInput) {
  await webClient.admin.setOAuthClient({ provider, ...client });
}
export async function removeOAuthClient(provider: ProviderId, serverUrl?: string) {
  await webClient.admin.removeOAuthClient({ provider, serverUrl });
}
export async function setInboxSecret(provider: ProviderId, inboxSecret: string) {
  await webClient.admin.setInboxSecret({ provider, inboxSecret });
}
export async function clearInboxSecret(provider: ProviderId) {
  await webClient.admin.clearInboxSecret({ provider });
}

export type OperationsStatus = {
  level: 'ready' | 'partial' | 'blocked';
  /** Exactly what an administrator still has to do, in the order it has to happen. */
  missing: string[];
};

/** Readiness in administrator terms: what is configured, and the next configuration step. */
function operationsStatus(
  provider: ProviderDefinition,
  readiness: ProviderReadiness | undefined,
): OperationsStatus {
  const enabled = readiness?.enabledUrls ?? [];
  const missing: string[] = [];
  if (!enabled.length) missing.push(`No ${provider.name} server is enabled.`);
  for (const url of enabled) {
    if (!readiness?.oauthUrls.includes(url)) missing.push(`No OAuth client covers ${url}.`);
  }
  if (!readiness?.reviewedTools) missing.push('No tool is reviewed, so every tool is blocked.');
  if (hasNativeInbox(provider) && !readiness?.inboxConfigured)
    missing.push('The native inbox secret is not set, so pushed events are rejected.');
  return { level: !enabled.length ? 'blocked' : missing.length ? 'partial' : 'ready', missing };
}

export function serverLabel(provider: ProviderDefinition, url: string) {
  return provider.products?.find((product) => product.url === url)?.name ?? provider.name;
}

function configFor(configs: ProviderConfig[], provider: ProviderId): ProviderConfig {
  return (
    configs.find((config) => config.provider === provider) ?? {
      provider,
      enabledUrls: [],
      oauthClients: [],
      hasInboxSecret: false,
    }
  );
}

export type ProviderRow = {
  provider: ProviderDefinition;
  config: ProviderConfig;
  status: OperationsStatus;
  reviewedTools: number;
};

/** One row per provider, so the overview and the cards read the same numbers. */
export function providerRows(configs: ProviderConfig[], readiness: ProviderReadiness[]): ProviderRow[] {
  return providers.map((provider) => {
    const entry = readiness.find((item) => item.provider === provider.id);
    return {
      provider,
      config: configFor(configs, provider.id),
      status: operationsStatus(provider, entry),
      reviewedTools: entry?.reviewedTools ?? 0,
    };
  });
}
