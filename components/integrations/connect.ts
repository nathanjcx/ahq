import type { Connection, ProviderId, ProviderReadiness } from '@/lib/contracts';
import { webApi } from '@/lib/ui-api';
import { providerServerUrls, type ProviderDefinition } from '@/lib/providers';

export type ProviderSetup = {
  /** Server URLs a user can connect right now. */
  connectable: string[];
  /** What an administrator still has to configure. Empty when at least one server is connectable. */
  missing: string[];
  /** Whether normalized inbox delivery is configured for this provider. */
  inboxConfigured: boolean;
};

export function providerSetup(provider: ProviderDefinition, readiness: ProviderReadiness[]): ProviderSetup {
  const entry = readiness.find((item) => item.provider === provider.id);
  const urls = providerServerUrls(provider);
  const enabled = urls.filter((url) => entry?.enabledUrls.includes(url));
  const withOAuth = urls.filter((url) => entry?.oauthUrls.includes(url));
  const missing: string[] = [];
  if (!enabled.length) missing.push('Enable its server URL on the Operations page.');
  else if (!withOAuth.length) missing.push('Add its OAuth client on the Operations page.');
  if (entry && !entry.reviewedTools) missing.push('Add reviewed tools to the tool registry.');
  return {
    connectable: entry?.reviewedTools ? withOAuth : [],
    missing,
    inboxConfigured: Boolean(entry?.inboxConfigured),
  };
}

export async function startConnect(provider: ProviderId, serverUrls?: string[]) {
  const response = await fetch(webApi.connect, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, serverUrls }),
  });
  const body = (await response.json()) as { authorizationUrl?: string; error?: string };
  if (!response.ok || !body.authorizationUrl) throw new Error(body.error || 'Connection failed');
  window.location.assign(body.authorizationUrl);
}

/** Who the owner is sharing a connection with. */
export function sharingSummary(connection: Connection) {
  if (connection.visibility === 'workspace') return 'Shared with workspace';
  const people = connection.visibleToSubjects.length;
  if (connection.visibility === 'members' && people)
    return `Shared with ${people} ${people === 1 ? 'person' : 'people'}`;
  return 'Private';
}

/** How wide a connection shared with the viewer reaches, from the viewer's side. */
export function sharedReach(connection: Connection) {
  if (connection.visibility === 'workspace') return 'Everyone';
  const others = connection.visibleToSubjects.length - 1;
  if (others <= 0) return 'Only you';
  return `You and ${others} ${others === 1 ? 'other' : 'others'}`;
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
