'use client';

import { CheckCircle2, Cloud, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import type { Dashboard, ModelUsage } from '@/lib/contracts';
import { modelName } from '../shared/format';
import { Sheet } from '../shared/sheet';

/** Cached tokens as a share of input tokens, the practical cache hit rate. */
function cacheHitRate(usage: ModelUsage) {
  return usage.input === 0 ? 'n/a' : `${Math.round((usage.cached / usage.input) * 100)}%`;
}

export function SettingsPanel({
  dashboard,
  configured,
  onClose,
  onBootstrap,
  onTokenCap,
}: {
  dashboard: Dashboard;
  configured: boolean;
  onClose: () => void;
  onBootstrap: (name: string) => void;
  onTokenCap: (monthlyTokenCap: number) => void;
}) {
  const workspace = dashboard.workspace;
  const [name, setName] = useState(workspace?.name ?? '');
  const [tokenCap, setTokenCap] = useState(String(workspace?.monthlyTokenCap ?? 0));
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';
  return (
    <Sheet
      title="Workspace settings"
      subtitle="Identity, token usage, and environment status for this workspace."
      onClose={onClose}
      footer={
        !workspace ? (
          <button className="primary-button full" type="submit" form="bootstrap-form" disabled={!configured}>
            Create workspace
          </button>
        ) : canManage ? (
          <button className="primary-button full" type="submit" form="token-cap-form">
            Save token cap
          </button>
        ) : undefined
      }
    >
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
            id="bootstrap-form"
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
                onChange={(e) => setName(e.target.value)}
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
                        <td>{usage.input.toLocaleString()}</td>
                        <td>{usage.cached.toLocaleString()}</td>
                        <td>{usage.output.toLocaleString()}</td>
                        <td>{cacheHitRate(usage)}</td>
                        <td>{usage.tasks.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No tokens recorded in this period yet.</p>
              )}
            </section>
            {canManage ? (
              <form
                id="token-cap-form"
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
                    value={tokenCap}
                    onChange={(e) => setTokenCap(e.target.value)}
                  />
                  <small>
                    Counted against input plus output tokens for the period. Use 0 for no limit. New tasks and
                    follow-up messages are refused once the cap is reached.
                  </small>
                </label>
              </form>
            ) : (
              <div className="settings-status">
                <LockKeyhole size={18} />
                <span>
                  <strong>Usage limits managed by an administrator</strong>
                  <small>Your workspace owner controls the monthly token cap.</small>
                </span>
              </div>
            )}
          </>
        )}
        <div id="setup" className="setup-list">
          <span className="eyebrow">SETUP CHECKLIST</span>
          <h3>Before the first real task</h3>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Connect authentication</strong>
                <small>Add the Clerk publishable and secret keys.</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Deploy application data</strong>
                <small>Set the Convex deployment URL and deploy functions.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Start the worker and gateway</strong>
                <small>Add the OpenAI key and shared service secret on Railway.</small>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Connect one MCP provider</strong>
                <small>Grant the smallest useful set of tools and resources.</small>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </Sheet>
  );
}
