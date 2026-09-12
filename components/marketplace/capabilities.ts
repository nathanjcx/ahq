import type { Connection, Listing } from '@/lib/contracts';

/** Providers a listing requires that no connected integration fully grants. */
export function missingRequiredCapabilities(listing: Listing, connections: Connection[]) {
  return [
    ...new Set(
      listing.capabilities
        .filter((capability) => {
          if (capability.optional) return false;
          return !connections.some(
            (connection) =>
              connection.provider === capability.provider &&
              connection.status === 'connected' &&
              capability.tools.every((tool) => connection.allowedTools.includes(tool)),
          );
        })
        .map((capability) => capability.provider),
    ),
  ];
}
