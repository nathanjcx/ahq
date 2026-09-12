'use client';

import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { OAuthClientConfig, ProviderConfig } from '@/lib/contracts';
import { providerServerUrls, type ProviderDefinition } from '@/lib/providers';
import { EmptyMini } from '../shared/empty';
import { relativeTime } from '../shared/format';
import { ProviderLogo } from '../shared/marks';
import { CopyLine } from './copy-line';
import { OAuthClientForm } from './oauth-client-form';
import {
  clearInboxSecret,
  hasNativeInbox,
  removeOAuthClient,
  saveOAuthClient,
  serverLabel,
  setInboxSecret,
  type OAuthClientInput,
  type OperationsStatus,
} from './operations-api';
import { ReadinessMark } from './operations-status';

export function ProviderOperationsCard({
  provider,
  config,
  status,
  origin,
  configured,
  onSetEnabledUrls,
  onNotice,
}: {
  provider: ProviderDefinition;
  config: ProviderConfig;
  status: OperationsStatus;
  origin: string;
  configured: boolean;
  onSetEnabledUrls: (urls: string[]) => void;
  onNotice: (text: string) => void;
}) {
  const [editing, setEditing] = useState<OAuthClientConfig | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const urls = providerServerUrls(provider);

  async function call(work: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await work();
      onNotice(success);
      return true;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'That change did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitClient(input: OAuthClientInput) {
    const saved = await call(() => saveOAuthClient(provider.id, input), 'OAuth client saved');
    if (saved) setEditing(null);
    return saved;
  }

  return (
    <details className="ops-provider card">
      <summary>
        <ProviderLogo provider={provider} />
        <span>
          <strong>{provider.name}</strong>
          <small>
            {config.enabledUrls.length} of {urls.length} servers enabled · {config.oauthClients.length} OAuth{' '}
            {config.oauthClients.length === 1 ? 'client' : 'clients'}
            {config.updatedAt ? ` · changed ${relativeTime(config.updatedAt)}` : ''}
          </small>
        </span>
        <ReadinessMark level={status.level} />
      </summary>

      <section className="ops-block">
        <h4>Enabled servers</h4>
        <p>A user can only connect to a server enabled here.</p>
        <div className="ops-checklist">
          {urls.map((url) => {
            const enabled = config.enabledUrls.includes(url);
            return (
              <label key={url}>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!configured}
                  onChange={() =>
                    onSetEnabledUrls(
                      enabled
                        ? config.enabledUrls.filter((item) => item !== url)
                        : [...config.enabledUrls, url],
                    )
                  }
                />
                <span>
                  <strong>{serverLabel(provider, url)}</strong>
                  <small>{url}</small>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="ops-block">
        <h4>OAuth clients</h4>
        <p>Register the callback URL below with the provider, then add the client it issues.</p>
        <CopyLine
          label="Redirect URI to register"
          value={origin ? `${origin}/api/integrations/callback` : ''}
        />
        {config.oauthClients.length ? (
          <div className="ops-rows">
            {config.oauthClients.map((client) => {
              const key = client.serverUrl ?? 'default';
              return (
                <div className="ops-row" key={key}>
                  <span className="ops-row-main">
                    <code>{client.clientId}</code>
                    <small>
                      {client.serverUrl ? serverLabel(provider, client.serverUrl) : 'Provider default'} ·{' '}
                      {client.hasClientSecret ? 'Secret set' : 'No secret'}
                      {client.scopes ? ` · ${client.scopes}` : ''}
                      {client.tokenAuthMethod ? ` · ${client.tokenAuthMethod}` : ''}
                    </small>
                  </span>
                  {removing === key ? (
                    <span className="ops-confirm">
                      <small>Remove this client?</small>
                      <button
                        type="button"
                        className="secondary-button compact danger"
                        disabled={busy}
                        onClick={async () => {
                          await call(
                            () => removeOAuthClient(provider.id, client.serverUrl),
                            'OAuth client removed',
                          );
                          setRemoving(null);
                        }}
                      >
                        Remove
                      </button>
                      <button type="button" className="text-button" onClick={() => setRemoving(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <span className="ops-row-actions">
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!configured}
                        onClick={() => setEditing(client)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact danger"
                        disabled={!configured}
                        onClick={() => setRemoving(key)}
                      >
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyMini
            icon={<KeyRound size={18} />}
            title="No OAuth client"
            text="Until a client is added, nobody can sign in to this provider."
          />
        )}
        {editing ? (
          <OAuthClientForm
            provider={provider}
            client={editing === 'new' ? null : editing}
            disabled={!configured || busy}
            onCancel={() => setEditing(null)}
            onSubmit={submitClient}
          />
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={!configured}
            onClick={() => setEditing('new')}
          >
            <Plus size={14} />
            Add OAuth client
          </button>
        )}
      </section>

      {hasNativeInbox(provider) && (
        <section className="ops-block">
          <h4>Native inbox secret</h4>
          <p>
            The signing secret {provider.name} uses for its webhooks. Events arriving without a valid
            signature are rejected.
          </p>
          <CopyLine
            label="Webhook URL to configure"
            value={origin ? `${origin}/api/webhooks/native/${provider.id}` : ''}
          />
          <div className="ops-secret">
            <span className={config.hasInboxSecret ? 'ops-set' : 'ops-unset'}>
              <ShieldCheck size={13} />
              {config.hasInboxSecret ? 'Set' : 'Not set'}
              {config.hasInboxSecret && config.updatedAt
                ? ` · updated ${relativeTime(config.updatedAt)}`
                : ''}
            </span>
            <input
              type="password"
              value={secret}
              aria-label={`${provider.name} webhook signing secret`}
              disabled={!configured}
              maxLength={2000}
              autoComplete="new-password"
              placeholder={config.hasInboxSecret ? 'New secret to replace it' : 'Signing secret'}
              onChange={(event) => setSecret(event.target.value)}
            />
            <button
              type="button"
              className="primary-button compact"
              disabled={!configured || busy || !secret.trim()}
              onClick={async () => {
                const saved = await call(
                  () => setInboxSecret(provider.id, secret.trim()),
                  'Inbox secret saved',
                );
                if (saved) setSecret('');
              }}
            >
              {config.hasInboxSecret ? 'Replace' : 'Set secret'}
            </button>
            {config.hasInboxSecret && (
              <button
                type="button"
                className="secondary-button compact danger"
                disabled={!configured || busy}
                onClick={() => call(() => clearInboxSecret(provider.id), 'Inbox secret cleared')}
              >
                Clear
              </button>
            )}
          </div>
        </section>
      )}
    </details>
  );
}
