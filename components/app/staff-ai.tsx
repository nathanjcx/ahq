'use client';

import {
  Authenticated,
  ConvexProvider,
  ConvexReactClient,
  Unauthenticated,
  useConvexAuth,
  useQuery,
} from 'convex/react';
import { FixtureQueriesContext } from '../shared/use-ui-query';
import { offlineActions, useWorkspaceActions } from './actions';
import { CenteredLoader, SignInScreen } from './status-screens';
import { WorkspaceShell } from './workspace-shell';
import { emptyDashboard } from '@/lib/contracts';
import { uiApi } from '@/lib/ui-api';

/**
 * Before the workspace is configured there is no deployment to subscribe to. Page-owned queries
 * still mount, so they get a client that is never asked anything (every query answers from the
 * empty fixture) rather than a missing provider.
 */
let placeholder: ConvexReactClient | undefined;
const noQueries = {};

export function StaffAi({ configured }: { configured: boolean }) {
  if (configured) return <ConnectedStaffAi />;
  placeholder ??= new ConvexReactClient('https://unconfigured.convex.cloud');
  return (
    <ConvexProvider client={placeholder}>
      <FixtureQueriesContext value={noQueries}>
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
      </FixtureQueriesContext>
    </ConvexProvider>
  );
}

function ConnectedStaffAi() {
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

  if (authLoading) return <CenteredLoader label="Opening Staff AI" />;

  return (
    <>
      <Unauthenticated>
        <SignInScreen />
      </Unauthenticated>
      <Authenticated>
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
      </Authenticated>
    </>
  );
}
