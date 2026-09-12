import { connection } from 'next/server';
import { ClientProviders, type PublicConfig } from '@/lib/client';
import { AstraHq } from '@/components/app';
import { webSetup } from '@/lib/server/setup';

export default async function Home() {
  // OAuth clients and webhook secrets are runtime variables, so read them per request, not at build.
  await connection();
  const config: PublicConfig = {
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  };
  const configured = Boolean(config.clerkPublishableKey && config.convexUrl);

  return (
    <ClientProviders config={config}>
      <AstraHq configured={configured} setup={webSetup()} />
    </ClientProviders>
  );
}
