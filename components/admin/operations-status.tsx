'use client';

import { AlertTriangle, Check, X } from 'lucide-react';
import { hasNativeInbox, type OperationsStatus, type ProviderRow } from './operations-api';

export function ReadinessMark({ level }: { level: OperationsStatus['level'] }) {
  const label = level === 'ready' ? 'Ready' : level === 'partial' ? 'Needs attention' : 'Not configured';
  return (
    <span className={`ops-mark ops-${level}`} role="img" title={label} aria-label={label}>
      {level === 'ready' ? (
        <Check size={12} />
      ) : level === 'partial' ? (
        <AlertTriangle size={12} />
      ) : (
        <X size={12} />
      )}
    </span>
  );
}

/** Readiness for every provider at a glance, with the next thing to do spelled out. */
export function OperationsOverview({ rows }: { rows: ProviderRow[] }) {
  return (
    <div className="ops-overview">
      {rows.map(({ provider, config, status, reviewedTools }) => (
        <article className="ops-overview-card" key={provider.id}>
          <header>
            <strong>{provider.name}</strong>
            <ReadinessMark level={status.level} />
          </header>
          <dl>
            <div>
              <dt>Servers enabled</dt>
              <dd>{config.enabledUrls.length}</dd>
            </div>
            <div>
              <dt>OAuth client</dt>
              <dd>{config.oauthClients.length ? 'Set' : 'Missing'}</dd>
            </div>
            <div>
              <dt>Reviewed tools</dt>
              <dd>{reviewedTools}</dd>
            </div>
            <div>
              <dt>Inbox secret</dt>
              <dd>{!hasNativeInbox(provider) ? 'Not used' : config.hasInboxSecret ? 'Set' : 'Missing'}</dd>
            </div>
          </dl>
          <p>{status.missing[0] ?? 'Everything this provider needs is configured.'}</p>
        </article>
      ))}
    </div>
  );
}
