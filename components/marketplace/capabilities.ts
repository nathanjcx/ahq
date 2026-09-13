import { capabilityGranted } from '@/lib/capabilities';
import type { Connection, Listing } from '@/lib/contracts';

/** Providers a listing requires that its connected integrations do not fully grant. */
export function missingRequiredCapabilities(listing: Listing, connections: Connection[]) {
  return [
    ...new Set(
      listing.capabilities
        .filter((capability) => !capability.optional && !capabilityGranted(capability, connections))
        .map((capability) => capability.provider),
    ),
  ];
}
