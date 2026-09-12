'use client';

import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { Bell, Menu, Plus, Settings } from 'lucide-react';
import type { ActionProposal } from '@/lib/contracts';

export function Topbar({
  title,
  configured,
  proposals,
  canCreateTask,
  onOpenNavigation,
  onNewTask,
  onSettings,
  onReview,
}: {
  title: string;
  configured: boolean;
  proposals: ActionProposal[];
  canCreateTask: boolean;
  onOpenNavigation: () => void;
  onNewTask: () => void;
  onSettings: () => void;
  onReview: (taskId: string) => void;
}) {
  const pending = proposals.find((proposal) => proposal.status === 'pending');
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button mobile-menu" onClick={onOpenNavigation} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <span>{title}</span>
      </div>
      <div className="topbar-actions">
        <button
          className="icon-button notification-button"
          aria-label="Open action reviews"
          title={pending ? 'Open action reviews' : 'No action reviews'}
          disabled={!pending}
          onClick={() => {
            if (pending) onReview(pending.taskId);
          }}
        >
          <Bell size={17} />
          {pending && <i />}
        </button>
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
