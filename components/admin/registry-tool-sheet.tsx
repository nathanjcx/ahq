'use client';

import { useState, type FormEvent } from 'react';
import type { ProviderId, RegistryTool, ToolMode } from '@/lib/contracts';
import { providers } from '@/lib/providers';
import { lines } from '../shared/format';
import { Sheet } from '../shared/sheet';

export type RegistryToolInput = Pick<
  RegistryTool,
  'provider' | 'name' | 'description' | 'mode' | 'resourceArgument' | 'correction'
>;

const modes: { id: ToolMode; title: string; text: string }[] = [
  { id: 'read', title: 'Read', text: 'Runs immediately and is journaled.' },
  { id: 'write', title: 'Write', text: 'Becomes a proposal a person has to approve.' },
  { id: 'blocked', title: 'Blocked', text: 'Never offered to an agent.' },
];

export function RegistryToolSheet({
  tool,
  defaultProvider,
  onClose,
  onSave,
}: {
  tool: RegistryTool | null;
  defaultProvider: ProviderId;
  onClose: () => void;
  onSave: (input: RegistryToolInput) => Promise<void>;
}) {
  const [provider, setProvider] = useState<ProviderId>(tool?.provider ?? defaultProvider);
  const [name, setName] = useState(tool?.name ?? '');
  const [description, setDescription] = useState(tool?.description ?? '');
  const [mode, setMode] = useState<ToolMode>(tool?.mode ?? 'blocked');
  const [resourceArgument, setResourceArgument] = useState(tool?.resourceArgument ?? '');
  const [correcting, setCorrecting] = useState(Boolean(tool?.correction));
  const [readTool, setReadTool] = useState(tool?.correction?.readTool ?? '');
  const [idArgument, setIdArgument] = useState(tool?.correction?.idArgument ?? '');
  const [versionField, setVersionField] = useState(tool?.correction?.versionField ?? '');
  const [expectedVersionArgument, setExpectedVersionArgument] = useState(
    tool?.correction?.expectedVersionArgument ?? '',
  );
  const [fields, setFields] = useState(tool?.correction?.fields.join('\n') ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        provider,
        name: name.trim(),
        description: description.trim(),
        mode,
        resourceArgument: resourceArgument.trim() || undefined,
        correction: correcting
          ? { readTool, idArgument, versionField, expectedVersionArgument, fields: lines(fields) }
          : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      wide
      title={tool ? `Edit ${tool.name}` : 'Add tool'}
      subtitle="A tool exists for agents only while this row exists and is not blocked."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" form="registry-tool-form" disabled={saving}>
            {saving ? 'Saving…' : 'Save tool'}
          </button>
        </>
      }
    >
      <form id="registry-tool-form" className="form-stack" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Provider
            <select
              value={provider}
              disabled={Boolean(tool)}
              onChange={(event) => setProvider(event.target.value as ProviderId)}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tool name
            <input
              value={name}
              readOnly={Boolean(tool)}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
              spellCheck={false}
            />
            <small>
              {tool
                ? 'The name is the identity of the row. Delete and add it again to rename it.'
                : 'Exactly as the MCP server reports it.'}
            </small>
          </label>
          <label className="full-field">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              placeholder="What this tool does, for the administrator reviewing it later."
            />
          </label>
        </div>

        <fieldset className="ops-modes">
          <legend>Mode</legend>
          {modes.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="mode"
                value={option.id}
                checked={mode === option.id}
                onChange={() => setMode(option.id)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.text}</small>
              </span>
            </label>
          ))}
          <p className="field-hint">
            A name that reads as destructive, such as delete, remove, purge, or destroy, cannot be saved as
            read.
          </p>
        </fieldset>

        <label>
          Resource argument
          <input
            value={resourceArgument}
            onChange={(event) => setResourceArgument(event.target.value)}
            spellCheck={false}
            placeholder="For example teamId"
          />
          <small>
            The argument checked against a connection&rsquo;s resource restriction. Without it, a restricted
            connection blocks this tool.
          </small>
        </label>

        <label className="ops-toggle">
          <input type="checkbox" checked={correcting} onChange={() => setCorrecting(!correcting)} />
          <span>
            <strong>This write can be corrected</strong>
            <small>
              Describes how to capture the state before the write and how to restore it afterwards.
            </small>
          </span>
        </label>
        {correcting && (
          <div className="form-grid">
            <label>
              Read tool
              <input
                value={readTool}
                onChange={(event) => setReadTool(event.target.value)}
                spellCheck={false}
              />
              <small>The audited read tool used to capture the record before the write.</small>
            </label>
            <label>
              Id argument
              <input
                value={idArgument}
                onChange={(event) => setIdArgument(event.target.value)}
                spellCheck={false}
              />
              <small>The argument that names the record, on both the write and the read tool.</small>
            </label>
            <label>
              Version field
              <input
                value={versionField}
                onChange={(event) => setVersionField(event.target.value)}
                spellCheck={false}
              />
              <small>The field in the read result that carries the record version.</small>
            </label>
            <label>
              Expected version argument
              <input
                value={expectedVersionArgument}
                onChange={(event) => setExpectedVersionArgument(event.target.value)}
                spellCheck={false}
              />
              <small>The argument that sends that version back, so a stale correction fails.</small>
            </label>
            <label className="full-field">
              Fields to restore, one per line
              <textarea
                value={fields}
                onChange={(event) => setFields(event.target.value)}
                spellCheck={false}
              />
              <small>Only these fields are written back when someone corrects the action.</small>
            </label>
          </div>
        )}
      </form>
    </Sheet>
  );
}
