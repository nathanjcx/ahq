'use client';

import { ExternalLink, Link2, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Connection } from '@/lib/contracts';
import type { ProviderDefinition } from '@/lib/providers';
import { ProviderLogo } from '../shared/marks';
import { OverflowMenu, type OverflowAction } from '../shared/overflow-menu';
import { useIsNarrow } from '../shared/use-media';
import { connectionLabel, sharedReach, sharingSummary, type ProviderSetup } from './connect';

function accountDetail(connection: Connection) {
  if (connection.status !== 'connected') return connection.error || 'Sign in again to continue.';
  return `${connection.allowedTools.length} of ${connection.tools.length} reviewed tools · ${
    connection.inboxMode === 'push' ? 'live inbox' : 'no inbox events yet'
  }`;
}

function AccountRow({ connection, children }: { connection: Connection; children: ReactNode }) {
  return (
    <div className="connection-account">
      <span>
        <strong>{connection.name}</strong>
        <small>{accountDetail(connection)}</small>
      </span>
      <span className={`connection-state ${connection.status}`}>
        <i />
        {connectionLabel(connection.status)}
      </span>
      <div>{children}</div>
    </div>
  );
}

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
  onShare,
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
  onShare: (connection: Connection) => void;
  onDisconnect: (connectionId: string) => void;
}) {
  const narrow = useIsNarrow();
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
  const owned = active.filter((item) => item.isOwner);
  const shared = active.filter((item) => !item.isOwner);
  const remainingProducts = provider.products?.filter(
    (product) =>
      state.connectable.includes(product.url) &&
      !connected.some((item) => item.isOwner && item.serverUrl === product.url),
  );
  // Only your own accounts decide whether you can add one, so a shared account never hides Connect.
  const canAdd = ready && (provider.products ? (remainingProducts?.length ?? 0) > 0 : owned.length === 0);
  // Connecting on top of someone else's shared account is about acting as yourself, not about access.
  const onlyShared = owned.length === 0 && shared.length > 0;
  const connectLabel = owned.length
    ? `Connect more ${provider.name} products`
    : onlyShared
      ? 'Connect your own'
      : `Connect ${provider.name}`;

  function ownedActions(connection: Connection): OverflowAction[] {
    return [
      { label: 'Sharing', onSelect: () => onShare(connection) },
      connection.status === 'connected'
        ? { label: 'Manage access', onSelect: () => onManage(connection) }
        : {
            label: 'Reconnect',
            disabled: busy || !state.connectable.includes(connection.serverUrl),
            onSelect: () => onConnect([connection.serverUrl]),
          },
      { label: 'Disconnect', danger: true, onSelect: () => onDisconnect(connection.id) },
    ];
  }

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
          {owned.map((connection) => (
            <AccountRow connection={connection} key={connection.id}>
              <span className="connection-sharing">{sharingSummary(connection)}</span>
              {narrow ? (
                <OverflowMenu label={`Actions for ${connection.name}`} actions={ownedActions(connection)} />
              ) : (
                ownedActions(connection).map((action) => (
                  <button
                    key={action.label}
                    className={`text-button ${action.danger ? 'danger-text' : ''}`}
                    disabled={action.disabled}
                    onClick={action.onSelect}
                  >
                    {action.label}
                  </button>
                ))
              )}
            </AccountRow>
          ))}
          {shared.map((connection) => (
            <AccountRow connection={connection} key={connection.id}>
              <span className="connection-shared">Shared by {connection.ownerName}</span>
              <span className="connection-reach">{sharedReach(connection)}</span>
            </AccountRow>
          ))}
        </div>
      )}
      {canAdd ? (
        <>
          <button
            className={`${owned.length ? 'secondary-button' : 'primary-button'} full`}
            disabled={busy}
            onClick={() => (provider.products ? onChooseProducts() : onConnect())}
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />}
            {connectLabel}
          </button>
          {onlyShared && (
            <p className="form-note connection-own-note">
              You can already use {shared[0].ownerName}&rsquo;s account. Connect your own to act as yourself.
            </p>
          )}
        </>
      ) : owned.length === 0 ? (
        <div className="setup-note">
          {!configured ? (
            <p>Connect the backend to enable integrations.</p>
          ) : checking ? (
            <p>Checking what your administrator has set up.</p>
          ) : canManage ? (
            <details>
              <summary>Setup needed</summary>
              <strong>Before anyone can connect {provider.name}</strong>
              <ul>
                {state.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a href={provider.documentation} target="_blank" rel="noreferrer">
                Provider setup guide <ExternalLink size={11} />
              </a>
            </details>
          ) : (
            <p>{provider.name} is not available yet. Ask your workspace administrator.</p>
          )}
        </div>
      ) : null}
      {owned.length === 0 && ready && !onlyShared && <p className="form-note">{provider.note}</p>}
    </article>
  );
}
