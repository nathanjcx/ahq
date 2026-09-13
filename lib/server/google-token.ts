import type { PrivateConnection } from '../../services/types';
import { mutate } from './backend';
import { oauthClient, type StoredCredential } from './oauth';
import { seal, unseal } from './secrets';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Refresh this long before expiry, so a token never dies mid-request. */
const EARLY_MS = 60_000;

/**
 * A live Google access token for a connection's grant, refreshed and re-sealed when the stored one
 * is about to expire. The Gmail REST API shares the grant the MCP servers use; this is the one place
 * that refreshes it outside an MCP transport.
 */
export async function googleAccessToken(
  connection: Pick<PrivateConnection, 'id' | 'provider' | 'serverUrl' | 'credentialCiphertext'>,
) {
  const credential = unseal<StoredCredential>(connection.credentialCiphertext);
  const state = credential.oauth;
  if (state.tokens?.access_token && (state.tokenExpiresAt ?? 0) > Date.now() + EARLY_MS)
    return state.tokens.access_token;
  if (!state.tokens?.refresh_token) throw new Error('The Google grant has no refresh token; reconnect it.');
  const client = await oauthClient(connection.provider, connection.serverUrl);
  if (!client) throw new Error('The Google OAuth client is not configured.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: state.tokens.refresh_token,
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Google refused the token refresh (${response.status}).`);
  const tokens = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  state.tokens = {
    ...state.tokens,
    ...tokens,
    refresh_token: tokens.refresh_token || state.tokens.refresh_token,
  };
  state.tokenExpiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  await mutate('services/integrations:refreshCredential', {
    connectionId: connection.id,
    credentialCiphertext: seal(credential),
  });
  return state.tokens.access_token;
}
