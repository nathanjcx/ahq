'use client';

import { CheckCircle2, Cloud } from 'lucide-react';
import { useState } from 'react';
import { modelName } from '../../shared/format';
import { formId, LockedNote } from './sections';
import type { Dashboard, ModelUsage } from '@/lib/contracts';

/** Cached tokens as a share of input tokens, the practical cache hit rate. */
function cacheHitRate(usage: ModelUsage) {
  return usage.input === 0 ? 'n/a' : `${Math.round((usage.cached / usage.input) * 100)}%`;
}

const setup = [
  { title: 'Connect authentication', hint: 'Add the Clerk publishable and secret keys.' },
  { title: 'Deploy application data', hint: 'Set the Convex deployment URL and deploy functions.' },
  { title: 'Start the worker and gateway', hint: 'Add the OpenAI key and shared service secret on Railway.' },
  { title: 'Connect one MCP provider', hint: 'Grant the smallest useful set of tools and resources.' },
];

/** Who this workspace is, what it has spent, and the ceiling on the period. */
export function WorkspaceSection({
  dashboard,
  configured,
  canManage,
  onBootstrap,
  onTokenCap,
}: {
  dashboard: Dashboard;
  configured: boolean;
  canManage: boolean;
  onBootstrap: (name: string) => void;
  onTokenCap: (monthlyTokenCap: number) => void;
}) {
  const workspace = dashboard.workspace;
  const [name, setName] = useState(workspace?.name ?? '');
  const [tokenCap, setTokenCap] = useState(String(workspace?.monthlyTokenCap ?? 0));

  return (
    <div className="settings-stack">
      {configured ? (
        <div className="settings-status good">
          <CheckCircle2 size={18} />
          <span>
            <strong>Application connected</strong>
            <small>
              {dashboard.viewer.name
                ? `Signed in as ${dashboard.viewer.name}.`
                : 'Clerk and Convex are configured.'}
            </small>
          </span>
        </div>
      ) : (
        <div className="settings-status">
          <Cloud size={18} />
          <span>
            <strong>Preview mode</strong>
            <small>Server environment variables are not available yet.</small>
          </span>
        </div>
      )}

      {!workspace ? (
        <form
          id={formId('workspace')}
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            onBootstrap(name.trim());
          }}
        >
          <label>
            Workspace name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Operations"
              required
            />
          </label>
        </form>
      ) : (
        <>
          <section className="usage-summary">
            <span className="eyebrow">TOKEN USAGE · {workspace.usage.period.toUpperCase()}</span>
            {workspace.usage.byModel.length ? (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Input</th>
                    <th>Cached</th>
                    <th>Output</th>
                    <th>Cache hits</th>
                    <th>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.usage.byModel.map((usage) => (
                    <tr key={usage.model}>
                      <th scope="row">{modelName(usage.model)}</th>
                      <td data-label="Input">{usage.input.toLocaleString()}</td>
                      <td data-label="Cached">{usage.cached.toLocaleString()}</td>
                      <td data-label="Output">{usage.output.toLocaleString()}</td>
                      <td data-label="Cache hits">{cacheHitRate(usage)}</td>
                      <td data-label="Tasks">{usage.tasks.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No tokens recorded in this period yet.</p>
            )}
          </section>
          <form
            id={formId('workspace')}
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              onTokenCap(Number(tokenCap));
            }}
          >
            <label>
              Monthly token cap
              <input
                type="number"
                min="0"
                step="1000"
                disabled={!canManage}
                value={tokenCap}
                onChange={(event) => setTokenCap(event.target.value)}
              />
              <small>
                Counted against input plus output tokens for the period. Use 0 for no limit. New tasks and
                follow-up messages are refused once the cap is reached.
              </small>
            </label>
          </form>
          {!canManage && <LockedNote what="Usage limits" />}
        </>
      )}

      <div id="setup" className="setup-list">
        <span className="eyebrow">SETUP CHECKLIST</span>
        <h3>Before the first real task</h3>
        <ol>
          {setup.map((step, index) => (
            <li key={step.title}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.hint}</small>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
