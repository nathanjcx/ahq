import {
  auth as mcpAuth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ProviderId } from '../contracts';
import { randomBytes } from 'node:crypto';
import { safeFetch } from './network';
import { requiredEnv, unseal } from './secrets';
import { providerRuntimeConfig } from './config';
import type { ProviderRuntimeConfig } from '../../services/types';
export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  scopes?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  tokenAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
}
export interface OAuthState {
  nonce: string;
  subject: string;
  orgId?: string;
  provider: ProviderId;
  name: string;
  serverUrl: string;
  /** Further servers of the same provider to connect after this one, in order. */
  queue?: string[];
  createdAt: number;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
  tokens?: OAuthTokens;
  tokenExpiresAt?: number;
}
export interface StoredCredential {
  oauth: OAuthState;
}

/**
 * Every OAuth endpoint this application uses, whether it came from the administrator's provider
 * configuration or from the server's own discovery document. The authorization endpoint is a
 * redirect target for the browser and the token endpoint is an outbound request, so neither is
 * allowed to be anything but plain HTTPS without embedded credentials.
 */
function httpsEndpoint(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The ${field} is not a valid URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error(`The ${field} must be an HTTPS URL without embedded credentials.`);
  return url.href;
}
/** The client registered for this exact server, otherwise the provider default entry. */
export function pickOAuthClient(config: ProviderRuntimeConfig, serverUrl?: string) {
  return (
    config.oauthClients.find((client) => client.serverUrl === serverUrl) ||
    config.oauthClients.find((client) => !client.serverUrl)
  );
}

export async function oauthClient(provider: string, serverUrl?: string): Promise<OAuthConfig> {
  const config = await providerRuntimeConfig(provider);
  const client = config && pickOAuthClient(config, serverUrl);
  if (!client?.clientId)
    throw new Error(
      `Sign-in for ${provider} is not set up yet. Ask your administrator to register its OAuth client.`,
    );
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecretCiphertext ? unseal<string>(client.clientSecretCiphertext) : undefined,
    scopes: client.scopes,
    authorizationUrl: client.authorizationUrl,
    tokenUrl: client.tokenUrl,
    tokenAuthMethod: client.tokenAuthMethod,
  };
}

function providerFor(
  state: OAuthState,
  settings: OAuthConfig,
  onTokens?: (state: OAuthState) => Promise<void>,
): { provider: OAuthClientProvider; redirect: () => string | undefined } {
  let authorizationUrl: string | undefined;
  const callback = new URL('/api/integrations/callback', requiredEnv('APP_URL')).href;
  if (settings.authorizationUrl && settings.tokenUrl && !state.discovery) {
    const authorization = httpsEndpoint(settings.authorizationUrl, 'authorization endpoint');
    const token = httpsEndpoint(settings.tokenUrl, 'token endpoint');
    state.discovery = {
      authorizationServerUrl: new URL(authorization).origin,
      authorizationServerMetadata: {
        issuer: new URL(authorization).origin,
        authorization_endpoint: authorization,
        token_endpoint: token,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: [
          settings.tokenAuthMethod || (settings.clientSecret ? 'client_secret_post' : 'none'),
        ],
      },
    };
  }
  const provider: OAuthClientProvider = {
    redirectUrl: callback,
    clientMetadata: {
      client_name: 'Astra HQ',
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        settings.tokenAuthMethod || (settings.clientSecret ? 'client_secret_post' : 'none'),
      ...(settings.scopes ? { scope: settings.scopes } : {}),
    },
    clientInformation: () => ({
      client_id: settings.clientId,
      ...(settings.clientSecret ? { client_secret: settings.clientSecret } : {}),
    }),
    state: () => state.nonce,
    tokens: () => state.tokens,
    saveTokens: async (tokens) => {
      state.tokens = { ...tokens, refresh_token: tokens.refresh_token || state.tokens?.refresh_token };
      state.tokenExpiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
      await onTokens?.(state);
    },
    redirectToAuthorization: (url) => {
      authorizationUrl = url.href;
    },
    saveCodeVerifier: (verifier) => {
      state.verifier = verifier;
    },
    codeVerifier: () => {
      if (!state.verifier) throw new Error('OAuth verifier is missing');
      return state.verifier;
    },
    discoveryState: () => state.discovery,
    saveDiscoveryState: (discovery) => {
      state.discovery = discovery;
    },
  };
  return { provider, redirect: () => authorizationUrl };
}
export async function startOAuth(input: Omit<OAuthState, 'nonce' | 'createdAt'>) {
  const state: OAuthState = { ...input, nonce: randomBytes(24).toString('base64url'), createdAt: Date.now() };
  const settings = await oauthClient(state.provider, state.serverUrl);
  const flow = providerFor(state, settings);
  await mcpAuth(flow.provider, { serverUrl: state.serverUrl, scope: settings.scopes, fetchFn: safeFetch });
  const authorizationUrl = flow.redirect();
  if (!authorizationUrl) throw new Error('Provider did not return an authorization page');
  // The browser is sent here, so it is checked again after discovery, not only after configuration.
  return { state, authorizationUrl: httpsEndpoint(authorizationUrl, 'authorization endpoint') };
}
export async function finishOAuth(state: OAuthState, code: string) {
  const { provider } = providerFor(state, await oauthClient(state.provider, state.serverUrl));
  const result = await mcpAuth(provider, {
    serverUrl: state.serverUrl,
    authorizationCode: code,
    fetchFn: safeFetch,
  });
  if (result !== 'AUTHORIZED' || !state.tokens)
    throw new Error('Authorization did not finish. Try connecting again.');
  // The stored grant is bound to this server; the pending product queue belongs to the callback only.
  delete state.queue;
  return { oauth: state } satisfies StoredCredential;
}
export async function oauthProvider(state: OAuthState, save: (state: OAuthState) => Promise<void>) {
  return providerFor(state, await oauthClient(state.provider, state.serverUrl), save).provider;
}
export function oauthCookie(requestUrl: string) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/api/integrations/callback',
    maxAge: 600,
    // Behind a TLS-terminating proxy the request URL is plain HTTP, so the deployed origin decides.
    secure: new URL(process.env.APP_URL || requestUrl).protocol === 'https:',
  };
}
