import { connection } from 'next/server';
import { ClientProviders, type PublicConfig } from '@/lib/client';
import { AstraHq } from '@/components/app';

export default async function Home() {
  // Clerk and Convex settings are runtime variables, so read them per request, not at build.
  await connection();
  const config: PublicConfig = {
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  };
  const configured = Boolean(config.clerkPublishableKey && config.convexUrl);

  return (
    <ClientProviders config={config}>
      <AstraHq configured={configured} />
    </ClientProviders>
  );
}
