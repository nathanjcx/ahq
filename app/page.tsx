import { connection } from 'next/server';
import { StaffAi } from '@/components/app';
import { ClientProviders, type PublicConfig } from '@/lib/client';
import { authConfigured } from '@/lib/server/workos';

export default async function Home() {
  // WorkOS and Convex settings are runtime variables, so read them per request, not at build.
  await connection();
  const config: PublicConfig = {
    authConfigured: authConfigured(),
    convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  };
  const configured = Boolean(config.authConfigured && config.convexUrl);

  return (
    <ClientProviders config={config}>
      <StaffAi configured={configured} />
    </ClientProviders>
  );
}
