'use client';

import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { useRef, type TouchEvent } from 'react';
import { AccountMenu, WorkspaceSwitcher } from './account';
import { destinations, type Page } from './nav';
import { Porthole } from './porthole';
import { useHoverIntent, type SidebarMode } from './use-sidebar';
import type { Dashboard } from '@/lib/contracts';

/** How far left a swipe has to travel before it closes the drawer. */
const SWIPE_CLOSE = 60;
const NEEDS = new Set(['needs_input', 'awaiting_approval']);
const RUNNING = new Set(['queued', 'running']);

type Badge = { count: number; tone: 'need' | 'run' };

/**
 * The building's spine. On a wide screen it is a 56px rail of icons and badges that opens to its
 * full width over the page while the pointer rests on it or focus is inside it, or stays open when
 * pinned. On a phone it is the drawer it always was.
 */
export function Sidebar({
  dashboard,
  configured,
  page,
  mode,
  pinned,
  onTogglePin,
  open,
  onClose,
  onNavigate,
  onSettings,
  floorId,
}: {
  dashboard: Dashboard;
  configured: boolean;
  page: Page;
  /** The resting width: a rail, or expanded. */
  mode: SidebarMode;
  /** Whether the person fixed the mode, rather than the page choosing it. */
  pinned: boolean;
  onTogglePin: () => void;
  /** The floor the porthole shows: the one last looked at, or the lobby. */
  floorId: string | null;
  /** The phone drawer. */
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
  const hover = useHoverIntent(mode === 'rail');
  const expanded = mode === 'expanded' || hover.hovering || open;

  // What each destination carries: what needs a person first, then what is moving.
  const needs = dashboard.tasks.filter((task) => NEEDS.has(task.status)).length;
  const running = dashboard.tasks.filter((task) => RUNNING.has(task.status)).length;
  const badges: Partial<Record<Page, Badge>> = {
    work: needs ? { count: needs, tone: 'need' } : running ? { count: running, tone: 'run' } : undefined,
  };
  const items = destinations.filter((item) => item.id !== 'admin' || dashboard.isPlatformAdmin);

  return (
    <aside
      className={`sidebar ${open ? 'sidebar-open' : ''}`}
      data-mode={expanded ? 'expanded' : 'rail'}
      data-overlay={mode === 'rail' && expanded && !open ? 'true' : undefined}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onPointerEnter={(event) => event.pointerType === 'mouse' && hover.enter()}
      onPointerLeave={(event) => event.pointerType === 'mouse' && hover.leave()}
      onFocus={hover.enter}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        hover.leave();
      }}
    >
      <div className="brand-row">
        <button className="brand" onClick={() => onNavigate('work')} aria-label="Staff AI home">
          <span className="brand-word">Staff</span> <i>AI</i>
        </button>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation">
          <PanelLeftClose size={18} />
        </button>
      </div>
      {configured && (
        <div className="sidebar-workspace">
          <WorkspaceSwitcher />
        </div>
      )}

      <nav className="nav" aria-label="Main navigation">
        {items
          .filter((item) => item.id !== 'admin')
          .map((item) => {
            const badge = badges[item.id];
            return (
              <button
                key={item.id}
                className="nav-item"
                data-active={page === item.id}
                aria-current={page === item.id ? 'page' : undefined}
                aria-label={badge ? `${item.label}, ${badge.count}` : item.label}
                title={expanded ? undefined : item.label}
                onClick={() => onNavigate(item.id)}
              >
                <item.icon size={17} strokeWidth={1.75} aria-hidden="true" />
                <span>{item.label}</span>
                {badge && (
                  <em className="nav-count" data-tone={badge.tone}>
                    {badge.count}
                  </em>
                )}
              </button>
            );
          })}
      </nav>

      <div className="sidebar-bottom">
        <button
          className="nav-item"
          onClick={onSettings}
          disabled={!configured}
          title={expanded ? undefined : 'Settings'}
        >
          <Settings size={17} strokeWidth={1.75} aria-hidden="true" />
          <span>Settings</span>
        </button>
        {dashboard.isPlatformAdmin && (
          <button
            className="nav-item"
            data-active={page === 'admin'}
            aria-current={page === 'admin' ? 'page' : undefined}
            title={expanded ? undefined : 'Platform admin'}
            onClick={() => onNavigate('admin')}
          >
            <ShieldIcon />
            <span>Platform admin</span>
          </button>
        )}
        <button
          className="nav-item sidebar-pin"
          aria-pressed={pinned}
          aria-expanded={expanded}
          title={mode === 'rail' ? 'Keep the sidebar open ([)' : 'Collapse the sidebar ([)'}
          onClick={onTogglePin}
        >
          {mode === 'rail' ? (
            <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span>{mode === 'rail' ? 'Keep open' : 'Collapse'}</span>
        </button>
        {/* Only while resting open: a canvas is too dear to mount on every hover. */}
        {configured && page !== 'office' && mode === 'expanded' && (
          <Porthole dashboard={dashboard} floorId={floorId} onOpen={() => onNavigate('office')} />
        )}
        {configured && (
          <div className="sidebar-account">
            <AccountMenu />
            <span className="sidebar-account-name">{dashboard.viewer.name}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function ShieldIcon() {
  const Icon = destinations.find((item) => item.id === 'admin')!.icon;
  return <Icon size={17} strokeWidth={1.75} aria-hidden="true" />;
}
