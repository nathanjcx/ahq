'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { useState, type ReactNode } from 'react';

export type PublicConfig = {
  clerkPublishableKey?: string;
  convexUrl?: string;
};

export function ClientProviders({ children, config }: { children: ReactNode; config: PublicConfig }) {
  if (!config.clerkPublishableKey || !config.convexUrl) return children;

  return <ConfiguredProviders config={config as Required<PublicConfig>}>{children}</ConfiguredProviders>;
}
function ConfiguredProviders({ children, config }: { children: ReactNode; config: Required<PublicConfig> }) {
  const [convex] = useState(() => new ConvexReactClient(config.convexUrl));
  return (
    <ClerkProvider publishableKey={config.clerkPublishableKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
