'use client';

import { useEffect, useState } from 'react';
import type {
  Connection,
  ProviderConfig,
  ProviderId,
  ProviderReadiness,
  RegistryTool,
} from '@/lib/contracts';
import { PageIntro } from '../shared/page-intro';
import { providerRows } from './operations-api';
import { OperationsOverview } from './operations-status';
import { ProviderOperationsCard } from './provider-operations-card';
import type { RegistryToolInput } from './registry-tool-sheet';
import { ToolRegistrySection } from './tool-registry-section';
import './operations.css';

export function OperationsPage({
  configs,
  registryTools,
  readiness,
  connections,
  configured,
  onSetEnabledUrls,
  onSaveTool,
  onDeleteTool,
  onImportTools,
  onNotice,
}: {
  configs: ProviderConfig[];
  registryTools: RegistryTool[];
  readiness: ProviderReadiness[];
  connections: Connection[];
  configured: boolean;
  onSetEnabledUrls: (provider: ProviderId, enabledUrls: string[]) => void;
  onSaveTool: (input: RegistryToolInput) => Promise<boolean>;
  onDeleteTool: (provider: ProviderId, name: string) => void;
  onImportTools: (connectionId: string) => Promise<number | null>;
  onNotice: (text: string) => void;
}) {
  // The URLs an administrator registers with a provider depend on where the app is served from.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const rows = providerRows(configs, readiness);

  return (
    <div>
      <PageIntro
        eyebrow="PLATFORM ADMIN"
        title="Operations"
        description="Provider configuration and the tool registry. Every service reads this, so a change here takes effect on the next agent call and the next sign-in."
      />
      <OperationsOverview rows={rows} />
      {!configured && (
        <p className="ops-lede">
          Preview mode. Connect Convex to read the live configuration and make changes.
        </p>
      )}

      <section className="admin-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">CONFIGURATION</span>
            <h2>Providers</h2>
          </div>
        </div>
        <div className="ops-providers">
          {rows.map(({ provider, config, status }) => (
            <ProviderOperationsCard
              key={provider.id}
              provider={provider}
              config={config}
              status={status}
              origin={origin}
              configured={configured}
              onSetEnabledUrls={(urls) => onSetEnabledUrls(provider.id, urls)}
              onNotice={onNotice}
            />
          ))}
        </div>
      </section>

      <ToolRegistrySection
        tools={registryTools}
        connections={connections}
        configured={configured}
        onSave={onSaveTool}
        onDelete={onDeleteTool}
        onImport={onImportTools}
        onNotice={onNotice}
      />

      <p className="ops-footnote">
        Token usage is recorded per workspace, not per provider. Open Workspace settings from the sidebar to
        see usage by model for the current period.
      </p>
    </div>
  );
}
