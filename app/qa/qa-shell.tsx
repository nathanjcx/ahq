'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { useEffect, useState } from 'react';
import { offlineActions } from '@/components/app/actions';
import { WorkspaceShell } from '@/components/app/workspace-shell';
import { qaFixture, type QaFixture } from './fixture';

/** Syntactically valid but unreachable. Clerk's widgets render their signed-out state and stop. */
const clerkKey = 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk';
const convex = new ConvexReactClient('https://quiet-otter-123.convex.cloud');

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
    <ClerkProvider publishableKey={clerkKey}>
      <ConvexProvider client={convex}>
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
      </ConvexProvider>
    </ClerkProvider>
  );
}
