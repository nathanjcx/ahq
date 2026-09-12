'use client';

import { useState } from 'react';
import type { Connection, ProviderId, ProviderReadiness } from '@/lib/contracts';
import { getProvider, providers } from '@/lib/providers';
import { PageIntro } from '../shared/page-intro';
import { providerSetup, startConnect } from './connect';
import { IntegrationCard } from './integration-card';
import { ManageAccessPanel } from './manage-access-panel';
import { ProductPicker } from './product-picker';

export function IntegrationsPage({
  connections,
  configured,
  readiness,
  canManage,
  onDisconnect,
  onUpdateAccess,
  onNotice,
}: {
  connections: Connection[];
  configured: boolean;
  readiness: ProviderReadiness[];
  canManage: boolean;
  onDisconnect: (id: string) => void;
  onUpdateAccess: (id: string, tools: string[], scope: string, inboxResources: string) => void;
  onNotice: (text: string) => void;
}) {
  const [choosingProducts, setChoosingProducts] = useState<ProviderId | null>(null);
  const [managing, setManaging] = useState<Connection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const checking = configured && readiness.length === 0;

  async function connect(provider: ProviderId, serverUrls?: string[]) {
    setBusy(provider);
    try {
      await startConnect(provider, serverUrls);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Connection failed');
      setBusy(null);
    }
  }

  return (
    <div>
      <PageIntro
        eyebrow="CONNECTIONS"
        title="Integrations"
        description="Sign in once per service. Employees only use the tools an administrator reviewed, and every external change waits for your approval."
      />
      <div className="integration-grid">
        {providers.map((provider) => (
          <IntegrationCard
            key={provider.id}
            provider={provider}
            state={providerSetup(provider, readiness)}
            connections={connections.filter((item) => item.provider === provider.id)}
            configured={configured}
            checking={checking}
            canManage={canManage}
            busy={busy === provider.id}
            onConnect={(serverUrls) => connect(provider.id, serverUrls)}
            onChooseProducts={() => setChoosingProducts(provider.id)}
            onManage={setManaging}
            onDisconnect={onDisconnect}
          />
        ))}
      </div>
      {choosingProducts && (
        <ProductPicker
          provider={getProvider(choosingProducts)}
          products={
            getProvider(choosingProducts).products?.filter((product) =>
              providerSetup(getProvider(choosingProducts), readiness).connectable.includes(product.url),
            ) ?? []
          }
          connected={connections
            .filter(
              (item) => item.provider === choosingProducts && item.status === 'connected' && item.isOwner,
            )
            .map((item) => item.serverUrl)}
          onClose={() => setChoosingProducts(null)}
          onConnect={(urls) => connect(choosingProducts, urls)}
        />
      )}
      {managing && (
        <ManageAccessPanel
          connection={managing}
          inboxConfigured={providerSetup(getProvider(managing.provider), readiness).inboxConfigured}
          onClose={() => setManaging(null)}
          onSave={(tools, scope, inboxResources) => {
            onUpdateAccess(managing.id, tools, scope, inboxResources);
            setManaging(null);
          }}
        />
      )}
    </div>
  );
}
