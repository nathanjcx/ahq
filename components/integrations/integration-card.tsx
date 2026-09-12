'use client';

import { ExternalLink, Link2, LoaderCircle } from 'lucide-react';
import type { Connection } from '@/lib/contracts';
import type { ProviderDefinition } from '@/lib/providers';
import { ProviderLogo } from '../shared/marks';
import { connectionLabel, type ProviderSetup } from './connect';

export function IntegrationCard({
  provider,
  state,
  connections,
  configured,
  checking,
  canManage,
  busy,
  onConnect,
  onChooseProducts,
  onManage,
  onDisconnect,
}: {
  provider: ProviderDefinition;
  state: ProviderSetup;
  connections: Connection[];
  configured: boolean;
  checking: boolean;
  canManage: boolean;
  busy: boolean;
  onConnect: (serverUrls?: string[]) => void;
  onChooseProducts: () => void;
  onManage: (connection: Connection) => void;
  onDisconnect: (connectionId: string) => void;
}) {
  const active = connections.filter((item) => item.status !== 'disconnected');
  const connected = active.filter((item) => item.status === 'connected');
  const attention = active.some((item) => item.status !== 'connected');
  const ready = configured && state.connectable.length > 0;
  const pill = attention
    ? { className: 'degraded', text: 'Needs attention' }
    : connected.length
      ? { className: 'connected', text: 'Connected' }
      : ready
        ? { className: 'available', text: 'Ready to connect' }
        : { className: 'setup', text: checking ? 'Checking setup' : 'Setup needed' };
  const remainingProducts = provider.products?.filter(
    (product) =>
      state.connectable.includes(product.url) && !connected.some((item) => item.serverUrl === product.url),
  );
  const canAdd = ready && (provider.products ? (remainingProducts?.length ?? 0) > 0 : active.length === 0);

  return (
    <article className="integration-card card">
      <div className="integration-top">
        <ProviderLogo provider={provider} />
        <span className={`connection-state ${pill.className}`}>
          <i />
          {pill.text}
        </span>
      </div>
      <h2>{provider.name}</h2>
      <p>{provider.description}</p>
      {active.length > 0 && (
        <div className="connection-accounts">
          {active.map((connection) => (
            <div className="connection-account" key={connection.id}>
              <span>
                <strong>{connection.name}</strong>
                <small>
                  {connection.status === 'connected'
                    ? `${connection.allowedTools.length} of ${connection.tools.length} reviewed tools · ${
                        connection.inboxMode === 'push' ? 'live inbox' : 'no inbox events yet'
                      }`
                    : connection.error || 'Sign in again to continue.'}
                </small>
              </span>
              <span className={`connection-state ${connection.status}`}>
                <i />
                {connectionLabel(connection.status)}
              </span>
              <div>
                {connection.status === 'connected' ? (
                  <button className="text-button" onClick={() => onManage(connection)}>
                    Manage access
                  </button>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy || !state.connectable.includes(connection.serverUrl)}
                    onClick={() => onConnect([connection.serverUrl])}
                  >
                    Reconnect
                  </button>
                )}
                <button className="text-button danger-text" onClick={() => onDisconnect(connection.id)}>
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {canAdd ? (
        <button
          className={`${active.length ? 'secondary-button' : 'primary-button'} full`}
          disabled={busy}
          onClick={() => (provider.products ? onChooseProducts() : onConnect())}
        >
          {busy ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />}
          {active.length ? `Connect more ${provider.name} products` : `Connect ${provider.name}`}
        </button>
      ) : active.length === 0 ? (
        <div className="setup-note">
          {!configured ? (
            <p>Connect the backend to enable integrations.</p>
          ) : checking ? (
            <p>Checking what your administrator has set up.</p>
          ) : canManage ? (
            <>
              <strong>Before anyone can connect {provider.name}</strong>
              <ul>
                {state.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a href={provider.documentation} target="_blank" rel="noreferrer">
                Provider setup guide <ExternalLink size={11} />
              </a>
            </>
          ) : (
            <p>{provider.name} is not available yet. Ask your workspace administrator.</p>
          )}
        </div>
      ) : null}
      {active.length === 0 && ready && <p className="form-note">{provider.note}</p>}
    </article>
  );
}
