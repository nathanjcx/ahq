'use client';

import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { useEffect, useState } from 'react';
import { qaFixture, type QaFixture } from './fixture';
import { fixtureQueries } from './fixtures';
import { offlineActions } from '@/components/app/actions';
import { IdentityContext, type Identity } from '@/components/app/identity';
import { WorkspaceShell } from '@/components/app/workspace-shell';
import { FixtureQueriesContext } from '@/components/shared/use-ui-query';

const convex = new ConvexReactClient('https://quiet-otter-123.convex.cloud');

/** A signed-in person, written down, so the account menu and workspace switcher photograph fully. */
const identity: Identity = {
  name: 'Riley Chen',
  email: 'riley@northwind.example',
  organizationId: 'org_northwind',
  organizations: [
    { id: 'org_northwind', name: 'Northwind Studio', role: 'admin' },
    { id: 'org_atlas', name: 'Atlas Logistics', role: 'member' },
  ],
  signOut: () => {},
  openOrganization: () => {},
  createOrganization: async () => {},
};

declare global {
  interface Window {
    /** The rendered fixture, plus a setter so a spec can photograph a variation of it. */
    __ahqFixture?: QaFixture & { apply: (next: Partial<QaFixture>) => void };
  }
}

export function QaWorkspace() {
  const [fixture, setFixture] = useState<QaFixture>(qaFixture);
  useEffect(() => {
    window.__ahqFixture = {
      ...fixture,
      apply: (next) => setFixture((current) => ({ ...current, ...next })),
    };
  }, [fixture]);

  return (
    <IdentityContext value={identity}>
      <ConvexProvider client={convex}>
        <FixtureQueriesContext value={fixtureQueries}>
          <WorkspaceShell
            configured
            dashboard={fixture.dashboard}
            listings={fixture.listings}
            drafts={fixture.drafts}
            registryTools={fixture.registryTools}
            providerConfigs={fixture.providerConfigs}
            readiness={fixture.readiness}
            actions={offlineActions}
          />
        </FixtureQueriesContext>
      </ConvexProvider>
    </IdentityContext>
  );
}
