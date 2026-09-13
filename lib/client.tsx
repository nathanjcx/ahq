'use client';

import { AuthKitProvider, useAccessToken, useAuth } from '@workos-inc/authkit-nextjs/components';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import { useCallback, useState, type ReactNode } from 'react';
import { WorkosIdentity } from '@/components/app/identity';

/**
 * What the browser needs to know. WorkOS needs nothing public: AuthKit reads the session on the
 * server and the browser talks to this application's own routes, so the client id and the API key
 * both stay server-side. `authConfigured` is only whether sign-in is available at all.
 */
export type PublicConfig = {
  authConfigured: boolean;
  convexUrl?: string;
};

export function ClientProviders({ children, config }: { children: ReactNode; config: PublicConfig }) {
  if (!config.authConfigured || !config.convexUrl) return children;
  return <ConfiguredProviders convexUrl={config.convexUrl}>{children}</ConfiguredProviders>;
}

function ConfiguredProviders({ children, convexUrl }: { children: ReactNode; convexUrl: string }) {
  const [convex] = useState(() => new ConvexReactClient(convexUrl));
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromAuthKit}>
        <WorkosIdentity>{children}</WorkosIdentity>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

/** Convex's auth contract, answered from AuthKit's access token store. */
function useConvexAuthFromAuthKit() {
  const { user, loading: isLoading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
      if (!user) return null;
      // No token means not signed in as far as Convex is concerned. A refresh that cannot reach the
      // server must report that rather than reject: AuthKit's token store already records the error
      // and its session watcher reloads the page when the session has really ended, while a rejection
      // here would leave the Convex socket with no auth state to act on.
      try {
        return (forceRefreshToken ? await refresh() : await getAccessToken()) ?? null;
      } catch {
        return null;
      }
    },
    [user, refresh, getAccessToken],
  );

  return { isLoading, isAuthenticated: Boolean(user), fetchAccessToken };
}
