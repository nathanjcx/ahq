'use client';

import { CheckCircle2, Cloud, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import type { Dashboard } from '@/lib/contracts';
import { Sheet } from '../shared/sheet';

export function SettingsPanel({
  dashboard,
  configured,
  onClose,
  onBootstrap,
  onBudget,
}: {
  dashboard: Dashboard;
  configured: boolean;
  onClose: () => void;
  onBootstrap: (name: string) => void;
  onBudget: (amount: number) => void;
}) {
  const [name, setName] = useState(dashboard.workspace?.name ?? '');
  const [budget, setBudget] = useState(String(dashboard.workspace?.monthlyBudget || 250));
  return (
    <Sheet
      title="Workspace settings"
      subtitle="Identity, budget, and environment status for this workspace."
      onClose={onClose}
    >
      <div className="settings-stack">
        {configured ? (
          <div className="settings-status good">
            <CheckCircle2 size={18} />
            <span>
              <strong>Application connected</strong>
              <small>Clerk and Convex are configured.</small>
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
        {!dashboard.workspace ? (
          <form
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
            <button className="primary-button full" disabled={!configured}>
              Create workspace
            </button>
          </form>
        ) : dashboard.workspace.role === 'owner' || dashboard.workspace.role === 'admin' ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              onBudget(Number(budget));
            }}
          >
            <label>
              Monthly OpenAI budget
              <div className="money-input">
                <span>$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <small>Work pauses before starting a task that would exceed this limit.</small>
            </label>
            <button className="primary-button full">Save budget</button>
          </form>
        ) : (
          <div className="settings-status">
            <LockKeyhole size={18} />
            <span>
              <strong>Budget managed by an administrator</strong>
              <small>Your workspace owner controls the monthly OpenAI limit.</small>
            </span>
          </div>
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
