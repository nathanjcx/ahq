import type { WebSetup } from '../contracts';
import { providers, providerServerUrls } from '../providers';
import { oauthConfigured } from './oauth';

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
