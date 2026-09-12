'use client';

import { useState, type FormEvent } from 'react';
import type { OAuthClientConfig } from '@/lib/contracts';
import { providerServerUrls, type ProviderDefinition } from '@/lib/providers';
import { serverLabel, type OAuthClientInput } from './operations-api';

/** Add or edit one OAuth client. The client secret leaves the browser once and never comes back. */
export function OAuthClientForm({
  provider,
  client,
  disabled,
  onCancel,
  onSubmit,
}: {
  provider: ProviderDefinition;
  client: OAuthClientConfig | null;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (input: OAuthClientInput) => Promise<boolean>;
}) {
  const [serverUrl, setServerUrl] = useState(client?.serverUrl ?? '');
  const [clientId, setClientId] = useState(client?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState(client?.scopes ?? '');
  const [authorizationUrl, setAuthorizationUrl] = useState(client?.authorizationUrl ?? '');
  const [tokenUrl, setTokenUrl] = useState(client?.tokenUrl ?? '');
  const [tokenAuthMethod, setTokenAuthMethod] = useState<
    NonNullable<OAuthClientConfig['tokenAuthMethod']> | ''
  >(client?.tokenAuthMethod ?? '');
  const [advanced, setAdvanced] = useState(
    Boolean(client?.authorizationUrl || client?.tokenUrl || client?.tokenAuthMethod),
  );
  const [saving, setSaving] = useState(false);
  const trimmed = (value: string) => value.trim() || undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await onSubmit({
        serverUrl: trimmed(serverUrl),
        clientId: clientId.trim(),
        clientSecret: trimmed(clientSecret),
        scopes: trimmed(scopes),
        authorizationUrl: advanced ? trimmed(authorizationUrl) : undefined,
        tokenUrl: advanced ? trimmed(tokenUrl) : undefined,
        tokenAuthMethod: advanced && tokenAuthMethod ? tokenAuthMethod : undefined,
      });
      if (saved) setClientSecret('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ops-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          MCP server
          <select
            value={serverUrl}
            disabled={Boolean(client)}
            onChange={(event) => setServerUrl(event.target.value)}
          >
            <option value="">Provider default, every enabled server</option>
            {providerServerUrls(provider).map((url) => (
              <option key={url} value={url}>
                {serverLabel(provider, url)} · {url}
              </option>
            ))}
          </select>
          <small>
            {client
              ? 'A client is keyed by its server. Remove and add it again to move it.'
              : 'The default client is used for every enabled server without its own client.'}
          </small>
        </label>
        <label>
          Client id
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            maxLength={500}
            required
            spellCheck={false}
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            maxLength={2000}
            autoComplete="new-password"
            placeholder={client?.hasClientSecret ? 'Leave blank to keep the stored secret' : 'Optional'}
          />
          <small>Sealed by the web service. It is never shown again.</small>
        </label>
        <label>
          Scopes
          <input
            value={scopes}
            onChange={(event) => setScopes(event.target.value)}
            maxLength={2000}
            spellCheck={false}
            placeholder="Space separated, as the provider documents them"
          />
        </label>
      </div>
      <button type="button" className="text-button" onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Hide' : 'Show'} fixed endpoints
      </button>
      {advanced && (
        <div className="form-grid">
          <label>
            Authorization URL
            <input
              type="url"
              value={authorizationUrl}
              onChange={(event) => setAuthorizationUrl(event.target.value)}
              spellCheck={false}
              placeholder="Leave blank to use metadata discovery"
            />
          </label>
          <label>
            Token URL
            <input
              type="url"
              value={tokenUrl}
              onChange={(event) => setTokenUrl(event.target.value)}
              spellCheck={false}
              placeholder="Leave blank to use metadata discovery"
            />
          </label>
          <label>
            Token authentication
            <select
              value={tokenAuthMethod}
              onChange={(event) => setTokenAuthMethod(event.target.value as typeof tokenAuthMethod)}
            >
              <option value="">Decide from provider metadata</option>
              <option value="client_secret_basic">client_secret_basic</option>
              <option value="client_secret_post">client_secret_post</option>
              <option value="none">none, public client</option>
            </select>
          </label>
        </div>
      )}
      <div className="ops-form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={disabled || saving}>
          {saving ? 'Saving…' : client ? 'Save client' : 'Add client'}
        </button>
      </div>
    </form>
  );
}
