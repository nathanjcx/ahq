'use client';

import { useState } from 'react';
import type { Connection } from '@/lib/contracts';
import { getProvider } from '@/lib/providers';
import { Sheet } from '../shared/sheet';
import { ToolChecklist } from '../shared/tool-checklist';
import { RelaySecret } from './relay-secret';

export function ManageAccessPanel({
  connection,
  inboxConfigured,
  onClose,
  onSave,
}: {
  connection: Connection;
  inboxConfigured: boolean;
  onClose: () => void;
  onSave: (tools: string[], scope: string, inboxResources: string) => void;
}) {
  const provider = getProvider(connection.provider);
  const [selected, setSelected] = useState(connection.allowedTools);
  const [scope, setScope] = useState(connection.resourceScope);
  const [inboxResources, setInboxResources] = useState(connection.inboxResources.join(', '));
  const [advanced, setAdvanced] = useState(Boolean(connection.resourceScope));
  const tools = connection.tools.map((name) => ({ name }));
  return (
    <Sheet
      title={`Manage ${connection.name}`}
      subtitle="Changes apply to new agent calls as soon as you save."
      onClose={onClose}
    >
      <div className="form-stack">
        <div className="permission-heading">
          <span className="eyebrow">TOOLS</span>
          <h3>What employees may use</h3>
          <p>Only tools your administrator reviewed appear here. Unchecking one revokes it immediately.</p>
        </div>
        <ToolChecklist tools={tools} selected={selected} onChange={setSelected} />
        {provider.inbox && (
          <label>
            Inbox: {provider.inbox.label} to follow
            <textarea
              value={inboxResources}
              onChange={(event) => setInboxResources(event.target.value)}
              placeholder={`Comma-separated, for example ${provider.inbox.example}`}
            />
            {!inboxConfigured && (
              <small className="field-hint">
                Event delivery for {provider.name} is not configured yet. Ask your administrator.
              </small>
            )}
          </label>
        )}
        {!provider.inbox && <RelaySecret connectionId={connection.id} />}
        <button type="button" className="text-button" onClick={() => setAdvanced(!advanced)}>
          {advanced ? 'Hide' : 'Show'} advanced restrictions
        </button>
        {advanced && (
          <label>
            Restrict tool calls to these resource IDs
            <textarea
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="Leave blank to rely on the provider account permissions."
            />
            <small className="field-hint">
              Applies only to tools with a verified resource mapping. Other tools are blocked while a
              restriction is set.
            </small>
          </label>
        )}
        <button className="primary-button full" onClick={() => onSave(selected, scope, inboxResources)}>
          Save access
        </button>
      </div>
    </Sheet>
  );
}
