'use client';

import { SignedIn, SignedOut } from '@clerk/nextjs';
import { useConvexAuth, useQuery } from 'convex/react';
import { emptyDashboard } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';
import { offlineActions, useWorkspaceActions } from './actions';
import { CenteredLoader, SignInScreen } from './status-screens';
import { WorkspaceShell } from './workspace-shell';

export function AstraHq({ configured }: { configured: boolean }) {
  return configured ? (
    <ConnectedAstraHq />
  ) : (
    <WorkspaceShell
      configured={false}
      readiness={[]}
      dashboard={emptyDashboard}
      listings={[]}
      drafts={[]}
      registryTools={[]}
      providerConfigs={[]}
      actions={offlineActions}
    />
  );
}

function ConnectedAstraHq() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const dashboard = useQuery(uiApi.dashboard, isAuthenticated ? {} : 'skip');
  const listings = useQuery(uiApi.listings, isAuthenticated ? {} : 'skip');
  const readiness = useQuery(uiApi.readiness, isAuthenticated && dashboard?.workspace ? {} : 'skip');
  const drafts = useQuery(uiApi.adminDrafts, isAuthenticated && dashboard?.isPlatformAdmin ? {} : 'skip');
  const registryTools = useQuery(
    uiApi.registryTools,
    isAuthenticated && dashboard?.isPlatformAdmin ? {} : 'skip',
  );
  const providerConfigs = useQuery(
    uiApi.providerConfigs,
    isAuthenticated && dashboard?.isPlatformAdmin ? {} : 'skip',
  );
  const actions = useWorkspaceActions();

  if (authLoading) return <CenteredLoader label="Opening Astra HQ" />;

  return (
    <>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
      <SignedIn>
        {dashboard === undefined || listings === undefined ? (
          <CenteredLoader label="Loading your workspace" />
        ) : (
          <WorkspaceShell
            configured
            readiness={readiness ?? []}
            dashboard={dashboard}
            listings={listings}
            drafts={(drafts ?? []).map((draft) => ({ ...draft, id: draft.draftId }))}
            registryTools={registryTools ?? []}
            providerConfigs={providerConfigs ?? []}
            actions={actions}
          />
        )}
      </SignedIn>
    </>
  );
}
