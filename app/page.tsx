import { ClientProviders, type PublicConfig } from '@/lib/client';
import { AstraHq } from '@/components/astra-hq';

export default function Home() {
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
