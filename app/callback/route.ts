import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * Where WorkOS returns after a sign-in. AuthKit exchanges the code, seals the session into its
 * cookie, and redirects to wherever the sign-in started. This path is the one that must appear in the
 * WorkOS dashboard's redirect URIs and in `NEXT_PUBLIC_WORKOS_REDIRECT_URI`.
 */
export const GET = handleAuth();
