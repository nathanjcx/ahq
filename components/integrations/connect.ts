import type { Connection, ProviderId, ProviderReadiness, WebSetup } from '@/lib/contracts';
import { providerServerUrls, type ProviderDefinition } from '@/lib/providers';

export type ProviderSetup = {
  /** Server URLs a user can connect right now. */
  connectable: string[];
  /** What an operator still has to configure. Empty when at least one server is connectable. */
  missing: string[];
};

export function providerSetup(
  provider: ProviderDefinition,
  readiness: ProviderReadiness[],
  setup: WebSetup,
): ProviderSetup {
  const entry = readiness.find((item) => item.provider === provider.id);
  const enabled = providerServerUrls(provider).filter((url) => entry?.enabledUrls.includes(url));
  const withOAuth = enabled.filter((url) => setup.oauthServers.includes(url));
  const missing: string[] = [];
  if (!enabled.length) missing.push('Enable its server URL in the Convex server allowlist.');
  else if (!withOAuth.length) missing.push('Register its OAuth client on the web service.');
  if (entry && !entry.reviewedTools) missing.push('Add reviewed tools to the tool registry.');
  return { connectable: entry && entry.reviewedTools ? withOAuth : [], missing };
}

export async function startConnect(provider: ProviderId, serverUrls?: string[]) {
  const response = await fetch('/api/integrations/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, serverUrls }),
  });
  const body = (await response.json()) as { authorizationUrl?: string; error?: string };
  if (!response.ok || !body.authorizationUrl) throw new Error(body.error || 'Connection failed');
  window.location.assign(body.authorizationUrl);
}

export function connectionLabel(status: Connection['status']) {
  return status === 'connected'
    ? 'Connected'
    : status === 'degraded'
      ? 'Needs attention'
      : status === 'revoked'
        ? 'Disconnected'
        : status;
}
