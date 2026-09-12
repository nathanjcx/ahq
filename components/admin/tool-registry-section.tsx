'use client';

import { Download, Plus, Search, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { Connection, ProviderId, RegistryTool } from '@/lib/contracts';
import { providers } from '@/lib/providers';
import { EmptyMini } from '../shared/empty';
import { providerName, relativeTime } from '../shared/format';
import { groupRegistryTools } from './registry';
import { RegistryToolSheet, type RegistryToolInput } from './registry-tool-sheet';

export function ToolRegistrySection({
  tools,
  connections,
  configured,
  onSave,
  onDelete,
  onImport,
  onNotice,
}: {
  tools: RegistryTool[];
  connections: Connection[];
  configured: boolean;
  onSave: (input: RegistryToolInput) => Promise<boolean>;
  onDelete: (provider: ProviderId, name: string) => void;
  onImport: (connectionId: string) => Promise<number | null>;
  onNotice: (text: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<RegistryTool | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [importFrom, setImportFrom] = useState('');
  const [importing, setImporting] = useState(false);
  const owned = connections.filter((connection) => connection.isOwner);
  const needle = filter.trim().toLowerCase();
  const grouped = groupRegistryTools(
    needle ? tools.filter((tool) => tool.name.toLowerCase().includes(needle)) : tools,
  );

  async function importTools() {
    setImporting(true);
    try {
      const imported = await onImport(importFrom);
      if (imported !== null) onNotice(`Imported ${imported} tools as blocked; review each one.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Those tools could not be imported.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="admin-section">
      <div className="section-title">
        <div>
          <span className="eyebrow">TOOL POLICY</span>
          <h2>Tool registry</h2>
        </div>
        <button className="primary-button compact" disabled={!configured} onClick={() => setEditing('new')}>
          <Plus size={15} />
          Add tool
        </button>
      </div>
      <p className="ops-lede">
        A tool reaches an agent only through a row here. Blocked rows stay in the registry as a record of what
        was reviewed.
      </p>

      <div className="ops-registry-toolbar">
        <span className="ops-search">
          <Search size={14} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by tool name"
            aria-label="Filter by tool name"
          />
        </span>
        <span className="ops-import">
          <select
            value={importFrom}
            disabled={!configured || !owned.length}
            onChange={(event) => setImportFrom(event.target.value)}
            aria-label="Import discovered tools from a connection"
          >
            <option value="">
              {owned.length ? 'Import from my connection…' : 'No connection of your own to import from'}
            </option>
            {owned.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {providerName(connection.provider)} · {connection.name}
              </option>
            ))}
          </select>
          <button
            className="secondary-button compact"
            disabled={!configured || !importFrom || importing}
            onClick={importTools}
          >
            <Download size={13} />
            {importing ? 'Importing…' : 'Import'}
          </button>
        </span>
      </div>

      {grouped.size ? (
        providers
          .filter((provider) => grouped.has(provider.id))
          .map((provider) => (
            <div className="ops-registry-group" key={provider.id}>
              <h4>
                {provider.name}
                <small>
                  {grouped.get(provider.id)?.length === 1
                    ? '1 tool'
                    : `${grouped.get(provider.id)?.length} tools`}
                </small>
              </h4>
              <div className="ops-rows">
                {[...(grouped.get(provider.id) ?? [])]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((tool) => {
                    const key = `${tool.provider}:${tool.name}`;
                    return (
                      <div className="ops-row" key={key}>
                        <span className="ops-row-main">
                          <code>{tool.name}</code>
                          <small>
                            {tool.resourceArgument
                              ? `Resource: ${tool.resourceArgument}`
                              : 'No resource argument'}{' '}
                            · Correction: {tool.correction ? 'yes' : 'no'} · Updated{' '}
                            {relativeTime(tool.updatedAt)} by {tool.updatedBy || 'unknown'}
                          </small>
                        </span>
                        <span className="ops-tool-tags">
                          <span className={`ops-mode ops-mode-${tool.mode}`}>{tool.mode}</span>
                          {tool.annotations?.readOnlyHint && <span className="ops-hint">read-only hint</span>}
                          {tool.annotations?.destructiveHint && (
                            <span className="ops-hint ops-hint-warn">destructive hint</span>
                          )}
                        </span>
                        {deleting === key ? (
                          <span className="ops-confirm">
                            <small>Delete this row? Agents lose the tool.</small>
                            <button
                              className="secondary-button compact danger"
                              onClick={() => {
                                onDelete(tool.provider, tool.name);
                                setDeleting(null);
                              }}
                            >
                              Delete
                            </button>
                            <button className="text-button" onClick={() => setDeleting(null)}>
                              Keep
                            </button>
                          </span>
                        ) : (
                          <span className="ops-row-actions">
                            <button
                              className="secondary-button compact"
                              disabled={!configured}
                              onClick={() => setEditing(tool)}
                            >
                              Edit
                            </button>
                            <button
                              className="secondary-button compact danger"
                              disabled={!configured}
                              onClick={() => setDeleting(key)}
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))
      ) : (
        <EmptyMini
          icon={<Wrench size={20} />}
          title={needle ? 'No tool matches that filter' : 'The registry is empty'}
          text={
            needle
              ? 'Clear the filter to see every reviewed tool.'
              : 'Import the tools discovered on one of your own connections, then review each one.'
          }
        />
      )}

      {editing && (
        <RegistryToolSheet
          tool={editing === 'new' ? null : editing}
          defaultProvider={providers[0].id}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (await onSave(input)) setEditing(null);
          }}
        />
      )}
    </section>
  );
}
