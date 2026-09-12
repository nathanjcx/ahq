import { providers, providerServerUrls } from '../providers';
import { oauthConfigured } from './oauth';

export interface WebSetup {
  /** MCP server URLs with a registered OAuth client. */
  oauthServers: string[];
  /** Providers with an app-level inbox webhook secret. */
  inboxProviders: string[];
}

/** Web-service deployment state. Convex reports the server allowlist and reviewed tools separately. */
export function webSetup(): WebSetup {
  const oauthServers = providers.flatMap((provider) =>
    providerServerUrls(provider).filter((url) => oauthConfigured(provider.id, url)),
  );
  const secrets = JSON.parse(process.env.NATIVE_INBOX_SECRETS_JSON || '{}') as Record<string, unknown>;
  const inboxProviders = providers
    .filter((provider) => provider.inbox && typeof secrets[provider.id] === 'string')
    .map((provider) => provider.id);
  return { oauthServers, inboxProviders };
}
