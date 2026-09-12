'use client';

import {
  MoreHorizontal,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useRef, type TouchEvent } from 'react';
import type { Dashboard } from '@/lib/contracts';
import { nav, type Page } from './nav';

/** How far left a swipe has to travel before it closes the drawer. */
const SWIPE_CLOSE = 60;

export function Sidebar({
  dashboard,
  page,
  open,
  onClose,
  onNavigate,
  onSettings,
}: {
  dashboard: Dashboard;
  page: Page;
  open: boolean;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onSettings: () => void;
}) {
  const workspace = dashboard.workspace;
  const swipeFrom = useRef<number | null>(null);
  const onTouchStart = (event: TouchEvent) => {
    swipeFrom.current = event.touches[0].clientX;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from !== null && event.changedTouches[0].clientX - from < -SWIPE_CLOSE) onClose();
  };

  return (
    <aside
      className={`sidebar ${open ? 'sidebar-open' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
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

      <div className="workspace-chip">
        <span className="workspace-mark">{workspace?.name?.slice(0, 1).toUpperCase() || 'A'}</span>
        <span>
          <strong>{workspace?.name || 'Your workspace'}</strong>
          <small>{workspace ? `${dashboard.employees.length} employees` : 'Ready to set up'}</small>
        </span>
      </div>

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
            <button
              className="nav-item"
              data-active={page === 'operations'}
              onClick={() => onNavigate('operations')}
            >
              <SlidersHorizontal size={17} />
              <span>Operations</span>
            </button>
          </>
        )}
      </nav>
    </aside>
  );
}
