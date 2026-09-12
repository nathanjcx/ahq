'use client';

import { SignedIn, SignedOut } from '@clerk/nextjs';
import { useConvexAuth, useQuery } from 'convex/react';
import { emptyDashboard, type WebSetup } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';
import { offlineActions, useWorkspaceActions } from './actions';
import { CenteredLoader, SignInScreen } from './status-screens';
import { WorkspaceShell } from './workspace-shell';

const emptySetup: WebSetup = { oauthServers: [], inboxProviders: [] };

export function AstraHq({ configured, setup }: { configured: boolean; setup: WebSetup }) {
  return configured ? (
    <ConnectedAstraHq setup={setup} />
  ) : (
    <WorkspaceShell
      configured={false}
      setup={emptySetup}
      readiness={[]}
      dashboard={emptyDashboard}
      listings={[]}
      drafts={[]}
      toolRegistry={[]}
      actions={offlineActions}
    />
  );
}

function ConnectedAstraHq({ setup }: { setup: WebSetup }) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const dashboard = useQuery(uiApi.dashboard, isAuthenticated ? {} : 'skip');
  const listings = useQuery(uiApi.listings, isAuthenticated ? {} : 'skip');
  const readiness = useQuery(uiApi.readiness, isAuthenticated && dashboard?.workspace ? {} : 'skip');
  const drafts = useQuery(uiApi.adminDrafts, isAuthenticated && dashboard?.isPlatformAdmin ? {} : 'skip');
  const toolRegistry = useQuery(
    uiApi.adminToolRegistry,
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
            setup={setup}
            readiness={readiness ?? []}
            dashboard={dashboard}
            listings={listings}
            drafts={(drafts ?? []).map((draft) => ({ ...draft, id: draft.draftId }))}
            toolRegistry={toolRegistry ?? []}
            actions={actions}
          />
        )}
      </SignedIn>
    </>
  );
}
