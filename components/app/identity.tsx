'use client';

import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { webClient } from '@/lib/api/client';
import type { OrganizationsResponse } from '@/lib/api/schemas';

export type Organization = OrganizationsResponse[number];

/**
 * The signed-in person and the workspaces they can open, as the shell needs them. It is a context
 * rather than a direct call into the identity provider so the fixture route can render the same
 * account menu and workspace switcher with no WorkOS environment behind them.
 */
export type Identity = {
  name: string;
  email?: string;
  imageUrl?: string;
  /** The organization the session is open on. Absent means the person's own workspace. */
  organizationId?: string;
  organizations: Organization[];
  /** Why the organization list is unavailable, if it is. */
  error?: string;
  signOut: () => void;
  /** Opens another organization's workspace. */
  openOrganization: (organizationId: string) => void;
  /** Creates an organization with this person as its administrator, then opens it. */
  createOrganization: (name: string) => Promise<void>;
};

const unconfigured: Identity = {
  name: 'Preview',
  organizations: [],
  signOut: () => {},
  openOrganization: () => {},
  createOrganization: async () => {},
};

export const IdentityContext = createContext<Identity>(unconfigured);

export function useIdentity() {
  return useContext(IdentityContext);
}

/**
 * The WorkOS-backed identity. The session comes from AuthKit; the organizations come from this
 * application's own route, because listing and creating them needs the WorkOS API key.
 *
 * Changing organization changes the workspace, the Convex access token, and every subscription that
 * reads from it, so the switch finishes with a fresh page rather than an in-place refetch.
 */
export function WorkosIdentity({ children }: { children: ReactNode }) {
  const { user, organizationId, signOut, switchToOrganization } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    webClient.organizations
      .list(controller.signal)
      .then((list) => setOrganizations(list))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load your workspaces.');
      });
    return () => controller.abort();
  }, [user]);

  const openOrganization = useCallback(
    (id: string) => {
      void switchToOrganization(id, { revalidationStrategy: 'none' }).then(() => window.location.assign('/'));
    },
    [switchToOrganization],
  );

  const createOrganization = useCallback(
    async (name: string) => {
      const created = await webClient.organizations.create({ name });
      openOrganization(created.id);
    },
    [openOrganization],
  );

  const identity = useMemo<Identity>(
    () => ({
      name:
        user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Member',
      email: user?.email,
      imageUrl: user?.profilePictureUrl ?? undefined,
      organizationId,
      organizations,
      error,
      signOut: () => void signOut({ returnTo: '/' }),
      openOrganization,
      createOrganization,
    }),
    [user, organizationId, organizations, error, signOut, openOrganization, createOrganization],
  );

  return <IdentityContext value={identity}>{children}</IdentityContext>;
}
