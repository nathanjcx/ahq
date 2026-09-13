import { handleAuth } from '@workos-inc/authkit-nextjs';

/**
 * Where WorkOS returns after a sign-in. AuthKit exchanges the code, seals the session into its
 * cookie, and redirects to wherever the sign-in started. This path is the one that must appear in the
 * WorkOS dashboard's redirect URIs and in `NEXT_PUBLIC_WORKOS_REDIRECT_URI`.
 */
// Behind the platform's proxy the request URL is the container's own address, so the redirect after
// sign-in is built on the public origin instead. Without APP_URL (local development) the request URL
// is right as it is.
export const GET = handleAuth(process.env.APP_URL ? { baseURL: process.env.APP_URL } : {});
