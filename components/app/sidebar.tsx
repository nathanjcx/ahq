'use client';

import {
  ChevronDown,
  CircleDollarSign,
  MoreHorizontal,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { Dashboard } from '@/lib/contracts';
import { nav, type Page } from './nav';

export function Sidebar({
  dashboard,
  configured,
  page,
  open,
  canManageWorkspace,
  onClose,
  onNavigate,
  onSettings,
}: {
  dashboard: Dashboard;
  configured: boolean;
  page: Page;
  open: boolean;
  canManageWorkspace: boolean;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onSettings: () => void;
}) {
  const workspace = dashboard.workspace;
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand-row">
        <button className="brand" onClick={() => onNavigate('office')} aria-label="Astra HQ home">
          <span className="brand-glyph" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <span>
            Astra <i>HQ</i>
          </span>
        </button>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation">
          <PanelLeftClose size={18} />
        </button>
      </div>

      <button className="workspace-chip" disabled={!configured} onClick={onSettings}>
        <span className="workspace-mark">{workspace?.name?.slice(0, 1).toUpperCase() || 'A'}</span>
        <span>
          <strong>{workspace?.name || 'Your workspace'}</strong>
          <small>{workspace ? `${dashboard.employees.length} employees` : 'Ready to set up'}</small>
        </span>
        <ChevronDown size={14} />
      </button>

      <nav aria-label="Main navigation">
        <span className="nav-heading">WORKSPACE</span>
        {nav.map((item) => {
          const Icon = item.icon;
          const count =
            item.id === 'inbox'
              ? dashboard.inbox.filter((i) => i.status === 'unread').length
              : item.id === 'tasks'
                ? dashboard.tasks.filter((t) => t.status === 'running' || t.status === 'awaiting_approval')
                    .length
                : 0;
          return (
            <button
              key={item.id}
              className="nav-item"
              data-active={page === item.id}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              {count > 0 && <span className="nav-badge">{count}</span>}
            </button>
          );
        })}
        {dashboard.isPlatformAdmin && (
          <>
            <span className="nav-heading nav-admin-heading">PLATFORM</span>
            <button className="nav-item" data-active={page === 'admin'} onClick={() => onNavigate('admin')}>
              <ShieldCheck size={17} />
              <span>Marketplace admin</span>
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {canManageWorkspace && (
          <div className="budget-mini">
            <span>
              <CircleDollarSign size={14} /> Monthly budget
            </span>
            <strong>
              {workspace
                ? `$${Math.round(workspace.spent)} of $${Math.round(workspace.monthlyBudget)}`
                : 'Not configured'}
            </strong>
            <div className="budget-track">
              <span
                style={{
                  width: workspace?.monthlyBudget
                    ? `${Math.min(100, (workspace.spent / workspace.monthlyBudget) * 100)}%`
                    : '0%',
                }}
              />
            </div>
          </div>
        )}
        <button className="account-row" onClick={onSettings}>
          <span className="avatar avatar-user">
            <Settings size={16} />
          </span>
          <span>
            <strong>Workspace settings</strong>
            <small>{workspace?.role || 'Configuration'}</small>
          </span>
          <MoreHorizontal size={16} />
        </button>
      </div>
    </aside>
  );
}
