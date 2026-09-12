'use client';

import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { ArrowUpRight, Bell, Check, CheckCheck, Menu, Plus, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '../shared/time';
import { useUiQuery } from '../shared/use-ui-query';
import type { TriageActions } from './actions/triage';
import type { Page } from './nav';
import type { ActionProposal, Notification } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/** Where a notification is about. Everything triage is on the Triage floor. */
const TARGET: Record<Notification['kind'], Page> = {
  triage: 'triage',
  meeting: 'calendar',
  finding: 'audit',
  general: 'activity',
};

export function Topbar({
  title,
  configured,
  proposals,
  canCreateTask,
  notificationActions,
  onOpenNavigation,
  onNewTask,
  onSettings,
  onReview,
  onOpen,
}: {
  title: string;
  configured: boolean;
  proposals: ActionProposal[];
  canCreateTask: boolean;
  /** Marking the ledger read. */
  notificationActions: Pick<TriageActions, 'acknowledgeNotification' | 'acknowledgeNotifications'>;
  onOpenNavigation: () => void;
  onNewTask: () => void;
  onSettings: () => void;
  onReview: (taskId: string) => void;
  /** Navigates to what a notification is about. */
  onOpen: (page: Page) => void;
}) {
  const pending = proposals.filter((proposal) => proposal.status === 'pending');

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button mobile-menu" onClick={onOpenNavigation} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <span>{title}</span>
      </div>
      <div className="topbar-actions">
        {configured ? (
          <LiveNotificationBell
            pending={pending}
            actions={notificationActions}
            onReview={onReview}
            onOpen={onOpen}
          />
        ) : (
          <NotificationBell
            notifications={[]}
            pending={pending}
            actions={notificationActions}
            onReview={onReview}
            onOpen={onOpen}
          />
        )}
        <button className="primary-button compact" disabled={!canCreateTask} onClick={onNewTask}>
          <Plus size={16} />
          New task
        </button>
        {configured && (
          <div className="clerk-organization">
            <OrganizationSwitcher afterSelectOrganizationUrl="/" />
          </div>
        )}
        <button
          className="icon-button topbar-settings"
          aria-label="Settings"
          disabled={!configured}
          onClick={onSettings}
        >
          <Settings size={18} />
        </button>
        {configured && (
          <div className="clerk-user">
            <UserButton />
          </div>
        )}
      </div>
    </header>
  );
}

type BellProps = {
  pending: ActionProposal[];
  actions: Pick<TriageActions, 'acknowledgeNotification' | 'acknowledgeNotifications'>;
  onReview: (taskId: string) => void;
  onOpen?: (page: Page) => void;
};

/** Subscribes to the ledger. Only mount this where a Convex client exists. */
function LiveNotificationBell(props: BellProps) {
  return <NotificationBell notifications={useUiQuery(uiApi.notifications, {})} {...props} />;
}

function NotificationBell({
  notifications,
  pending,
  actions,
  onReview,
  onOpen,
}: BellProps & { notifications: Notification[] | undefined }) {
  const [open, setOpen] = useState(false);
  const unread = (notifications ?? []).filter((row) => !row.acknowledgedAt);
  const count = unread.length + pending.length;

  return (
    <div className="notification-bell">
      <button
        className="icon-button notification-button"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Bell size={17} />
        {count > 0 && <i>{count > 9 ? '9+' : count}</i>}
      </button>
      {open && (
        <NotificationPanel
          notifications={notifications}
          unreadCount={unread.length}
          pending={pending}
          actions={actions}
          onClose={() => setOpen(false)}
          onReview={(taskId) => {
            setOpen(false);
            onReview(taskId);
          }}
          onOpen={(page) => {
            setOpen(false);
            onOpen(page);
          }}
        />
      )}
    </div>
  );
}

function NotificationPanel({
  notifications,
  unreadCount,
  pending,
  actions,
  onClose,
  onReview,
  onOpen,
}: {
  notifications: Notification[] | undefined;
  unreadCount: number;
  pending: ActionProposal[];
  actions: Pick<TriageActions, 'acknowledgeNotification' | 'acknowledgeNotifications'>;
  onClose: () => void;
  onReview: (taskId: string) => void;
  onOpen?: (page: Page) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <button className="bell-scrim" tabIndex={-1} aria-label="Close notifications" onClick={onClose} />
      <div className="bell-panel" role="dialog" aria-label="Notifications">
        <header>
          <strong>Notifications</strong>
          <button
            className="text-button"
            disabled={!unreadCount}
            onClick={() => void actions.acknowledgeNotifications()}
          >
            <CheckCheck size={14} /> Mark all read
          </button>
        </header>

        {pending.length > 0 && (
          <button className="bell-review" onClick={() => onReview(pending[0].taskId)}>
            <span>
              <strong>
                {pending.length} action{pending.length === 1 ? '' : 's'} waiting for review
              </strong>
              <small>{pending[0].employeeName} is holding until you decide.</small>
            </span>
            <ArrowUpRight size={14} />
          </button>
        )}

        <div className="bell-list">
          {notifications === undefined ? (
            <p className="bell-empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="bell-empty">Nothing has needed you yet.</p>
          ) : (
            notifications.map((row) => (
              <article key={row.id} className="bell-item" data-unread={!row.acknowledgedAt}>
                <header>
                  <strong>{row.title}</strong>
                  <small>{relativeTime(row.sentAt)}</small>
                </header>
                <p>{row.text}</p>
                <footer>
                  <button className="text-button" onClick={() => onOpen(TARGET[row.kind])}>
                    Open <ArrowUpRight size={13} />
                  </button>
                  {!row.acknowledgedAt && (
                    <button
                      className="text-button"
                      onClick={() => void actions.acknowledgeNotification(row.id)}
                    >
                      <Check size={13} /> Mark read
                    </button>
                  )}
                </footer>
              </article>
            ))
          )}
        </div>
      </div>
    </>
  );
}
