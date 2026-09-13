'use client';

import { Building2, Check, ChevronsUpDown, LogOut, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIdentity } from './identity';
import './app.css';

/** Closes a popover on Escape. A click elsewhere is caught by the scrim the panel renders with it. */
function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

/** The signed-in person, and the way out. */
export function AccountMenu() {
  const identity = useIdentity();
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));

  return (
    <div className="account-menu">
      <button
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account, ${identity.name}`}
        onClick={() => setOpen((shown) => !shown)}
      >
        {identity.imageUrl ? <img src={identity.imageUrl} alt="" /> : <span>{initials(identity.name)}</span>}
      </button>
      {open && (
        <>
          <button
            className="popover-scrim"
            tabIndex={-1}
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
          />
          <div className="account-panel" role="menu" aria-label="Account">
            <div className="account-who">
              <strong>{identity.name}</strong>
              {identity.email && <small>{identity.email}</small>}
            </div>
            <button role="menuitem" onClick={identity.signOut}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Which workspace this session is open on. A workspace is an organization, so moving between them is
 * how a person moves between workspaces; creating one is the way to invite colleagues into a shared
 * workspace. A session that belongs to no organization is the person's own workspace, and WorkOS has
 * no way back to it once an organization is chosen, so it is shown but never offered.
 */
export function WorkspaceSwitcher() {
  const identity = useIdentity();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();
  useDismiss(open, () => setOpen(false));

  const current = identity.organizations.find((organization) => organization.id === identity.organizationId);
  const label = current?.name ?? (identity.organizationId ? 'Workspace' : 'Personal workspace');
  const problem = failure ?? identity.error;

  return (
    <div className="workspace-switcher">
      <button
        className="workspace-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Building2 size={14} />
        <span>{label}</span>
        <ChevronsUpDown size={13} />
      </button>
      {open && (
        <>
          <button
            className="popover-scrim"
            tabIndex={-1}
            aria-label="Close workspace menu"
            onClick={() => setOpen(false)}
          />
          <div className="workspace-panel" role="menu" aria-label="Workspaces">
            {problem && <p className="field-hint">{problem}</p>}
            {!identity.organizationId && (
              <button role="menuitem" className="is-current" disabled>
                Personal workspace <Check size={14} />
              </button>
            )}
            {identity.organizations.map((organization) => {
              const active = organization.id === identity.organizationId;
              return (
                <button
                  key={organization.id}
                  role="menuitem"
                  className={active ? 'is-current' : undefined}
                  disabled={active}
                  onClick={() => identity.openOrganization(organization.id)}
                >
                  {organization.name} {active && <Check size={14} />}
                </button>
              );
            })}
            {creating ? (
              <form
                className="workspace-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  setFailure(undefined);
                  identity.createOrganization(name.trim()).catch((cause: unknown) => {
                    setFailure(cause instanceof Error ? cause.message : 'Could not create the workspace.');
                  });
                }}
              >
                <input
                  autoFocus
                  value={name}
                  maxLength={80}
                  placeholder="Workspace name"
                  aria-label="New workspace name"
                  onChange={(event) => setName(event.target.value)}
                />
                <button className="primary-button" disabled={!name.trim()}>
                  Create
                </button>
              </form>
            ) : (
              <button role="menuitem" className="workspace-new" onClick={() => setCreating(true)}>
                <Plus size={14} /> New workspace
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
