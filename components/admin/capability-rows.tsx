'use client';

import { Link2, LockKeyhole, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Capability, ProviderId } from '@/lib/contracts';
import type { AdminToolRegistry } from '@/lib/ui-api';
import { providers } from '@/lib/providers';
import { EmptyMini } from '../shared/empty';

export type CapabilityRow = Capability & { rowId: string };

export function CapabilityRows({
  capabilities,
  toolRegistry,
  onChange,
}: {
  capabilities: CapabilityRow[];
  toolRegistry: AdminToolRegistry;
  onChange: Dispatch<SetStateAction<CapabilityRow[]>>;
}) {
  return (
    <div className="editor-rows">
      {capabilities.map((capability) => {
        const registry = toolRegistry.find((item) => item.provider === capability.provider);
        const registeredTools = registry?.tools ?? [];
        const visibleTools = [
          ...registeredTools,
          ...capability.tools
            .filter((name) => !registeredTools.some((tool) => tool.name === name))
            .map((name) => ({
              name,
              description: 'Not in the current registry',
              mode: 'blocked' as const,
            })),
        ];
        return (
          <div className="editor-row capability-editor" key={capability.rowId}>
            <div className="editor-row-head">
              <label>
                MCP provider
                <select
                  value={capability.provider}
                  onChange={(event) =>
                    onChange((items) =>
                      items.map((item) =>
                        item.rowId === capability.rowId
                          ? { ...item, provider: event.target.value as ProviderId, tools: [] }
                          : item,
                      ),
                    )
                  }
                >
                  {providers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={capability.optional}
                  onChange={(event) =>
                    onChange((items) =>
                      items.map((item) =>
                        item.rowId === capability.rowId ? { ...item, optional: event.target.checked } : item,
                      ),
                    )
                  }
                />
                <span>
                  <strong>Optional</strong>
                  <small>Can run without it</small>
                </span>
              </label>
              <button
                type="button"
                className="icon-button danger-text"
                aria-label="Remove capability"
                onClick={() => onChange((items) => items.filter((item) => item.rowId !== capability.rowId))}
              >
                <X size={16} />
              </button>
            </div>
            {!registry?.configured && (
              <p className="registry-warning">
                <LockKeyhole size={13} /> Configure this provider in MCP_TOOL_REGISTRY_JSON before publishing.
              </p>
            )}
            <div className="registry-tools">
              {visibleTools.length ? (
                visibleTools.map((tool) => {
                  const checked = capability.tools.includes(tool.name);
                  return (
                    <label key={tool.name} data-mode={tool.mode}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={tool.mode === 'blocked' && !checked}
                        onChange={() =>
                          onChange((items) =>
                            items.map((item) =>
                              item.rowId === capability.rowId
                                ? {
                                    ...item,
                                    tools: checked
                                      ? item.tools.filter((name) => name !== tool.name)
                                      : [...item.tools, tool.name],
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                      <span>
                        <strong>{tool.name}</strong>
                        <small>{tool.description || tool.mode}</small>
                      </span>
                      <em>{tool.mode}</em>
                    </label>
                  );
                })
              ) : (
                <p>No tools are registered for this provider.</p>
              )}
            </div>
          </div>
        );
      })}
      {!capabilities.length && (
        <EmptyMini
          icon={<Link2 size={19} />}
          title="No MCP access"
          text="This employee will run without external integrations."
        />
      )}
    </div>
  );
}
