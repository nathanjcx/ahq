import {
  auth as mcpAuth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes } from 'node:crypto';
import { safeFetch } from './network';
import { requiredEnv } from './secrets';
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
  provider: string;
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
  accessToken?: string;
  oauth?: OAuthState;
}
function configured(provider: string, serverUrl?: string): OAuthConfig | undefined {
  const configs = JSON.parse(process.env.MCP_OAUTH_CONFIG_JSON || '{}') as Record<string, OAuthConfig>;
  const value = (serverUrl ? configs[serverUrl] : undefined) || configs[provider];
  return value?.clientId ? value : undefined;
}
export function oauthConfigured(provider: string, serverUrl?: string) {
  return Boolean(configured(provider, serverUrl));
}
function config(provider: string, serverUrl?: string): OAuthConfig {
  const value = configured(provider, serverUrl);
  if (!value)
    throw new Error(`Sign-in for ${provider} is not set up yet. Ask your administrator to register its OAuth client.`);
  return value;
}
function providerFor(
  state: OAuthState,
  onTokens?: (state: OAuthState) => Promise<void>,
): { provider: OAuthClientProvider; redirect: () => string | undefined } {
  const settings = config(state.provider, state.serverUrl);
  let authorizationUrl: string | undefined;
  const callback = new URL('/api/integrations/callback', requiredEnv('APP_URL')).href;
  if (settings.authorizationUrl && settings.tokenUrl && !state.discovery) {
    state.discovery = {
      authorizationServerUrl: new URL(settings.authorizationUrl).origin,
      authorizationServerMetadata: {
        issuer: new URL(settings.authorizationUrl).origin,
        authorization_endpoint: settings.authorizationUrl,
        token_endpoint: settings.tokenUrl,
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
  const flow = providerFor(state);
  await mcpAuth(flow.provider, {
    serverUrl: state.serverUrl,
    scope: config(state.provider, state.serverUrl).scopes,
    fetchFn: safeFetch,
  });
  const authorizationUrl = flow.redirect();
  if (!authorizationUrl) throw new Error('Provider did not return an authorization page');
  return { state, authorizationUrl };
}
export async function finishOAuth(state: OAuthState, code: string) {
  const { provider } = providerFor(state);
  const result = await mcpAuth(provider, {
    serverUrl: state.serverUrl,
    authorizationCode: code,
    fetchFn: safeFetch,
  });
  if (result !== 'AUTHORIZED' || !state.tokens)
    throw new Error('Authorization did not finish. Try connecting again.');
  return { oauth: state } satisfies StoredCredential;
}
export function oauthProvider(state: OAuthState, save: (state: OAuthState) => Promise<void>) {
  return providerFor(state, save).provider;
}
export function oauthCookie(requestUrl: string) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/api/integrations/callback',
    maxAge: 600,
    secure: new URL(requestUrl).protocol === 'https:',
  };
}
