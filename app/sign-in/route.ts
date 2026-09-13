import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';
import { jsonError } from '@/lib/server/http';
import { authConfigured } from '@/lib/server/workos';

/**
 * The whole sign-in flow: a plain link to this path. Minting the URL sets the single-use PKCE
 * verifier cookie, which only a server can do, so the sign-in button is an anchor rather than script.
 */
export async function GET() {
  if (!authConfigured()) return jsonError(503, 'Sign-in has not been configured yet.', 'not_configured');
  redirect(await getSignInUrl({ returnTo: '/' }));
}
