'use client';

import { PanelLeftClose, Settings } from 'lucide-react';
import { useRef, type TouchEvent } from 'react';
import { AccountMenu, WorkspaceSwitcher } from './account';
import { destinations, type Page } from './nav';
import type { Dashboard } from '@/lib/contracts';

/** How far left a swipe has to travel before it closes the drawer. */
const SWIPE_CLOSE = 60;

export function Sidebar({
  dashboard,
  configured,
  page,
  open,
  onClose,
  onNavigate,
  onSettings,
}: {
  dashboard: Dashboard;
  configured: boolean;
  page: Page;
  open: boolean;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onSettings: () => void;
}) {
  const swipeFrom = useRef<number | null>(null);
  const onTouchStart = (event: TouchEvent) => {
    swipeFrom.current = event.touches[0].clientX;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from !== null && event.changedTouches[0].clientX - from < -SWIPE_CLOSE) onClose();
  };
  const counts: Partial<Record<Page, number>> = {
    work:
      dashboard.proposals.filter((proposal) => proposal.status === 'pending').length +
      dashboard.inbox.filter((item) => item.status === 'unread').length,
    team: dashboard.employees.length,
  };
  const items = destinations.filter((item) => item.id !== 'admin' || dashboard.isPlatformAdmin);

  return (
    <aside
      className={`sidebar ${open ? 'sidebar-open' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="brand-row">
        <button className="brand" onClick={() => onNavigate('work')} aria-label="Staff AI home">
          Staff <i>AI</i>
        </button>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation">
          <PanelLeftClose size={18} />
        </button>
      </div>

      <nav className="nav" aria-label="Main navigation">
        {items
          .filter((item) => item.id !== 'admin')
          .map((item) => (
            <button
              key={item.id}
              className="nav-item"
              data-active={page === item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <item.icon size={16} strokeWidth={1.75} />
              <span>{item.label}</span>
              {counts[item.id] ? (
                <em className="nav-count" data-hot={item.id === 'work'}>
                  {counts[item.id]}
                </em>
              ) : null}
            </button>
          ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="nav-item" onClick={onSettings} disabled={!configured}>
          <Settings size={16} strokeWidth={1.75} />
          <span>Settings</span>
        </button>
        {dashboard.isPlatformAdmin && (
          <button
            className="nav-item"
            data-active={page === 'admin'}
            aria-current={page === 'admin' ? 'page' : undefined}
            onClick={() => onNavigate('admin')}
          >
            <ShieldIcon />
            <span>Platform admin</span>
          </button>
        )}
        {configured && (
          <div className="sidebar-account">
            <WorkspaceSwitcher />
            <AccountMenu />
          </div>
        )}
      </div>
    </aside>
  );
}

function ShieldIcon() {
  const Icon = destinations.find((item) => item.id === 'admin')!.icon;
  return <Icon size={16} strokeWidth={1.75} />;
}
