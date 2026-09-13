import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

/**
 * The whole sign-in flow: a plain link to this path. Minting the URL sets the PKCE verifier cookie,
 * which only a server can do, so the sign-in button is an anchor rather than script.
 */
export async function GET() {
  redirect(await getSignInUrl({ returnTo: '/' }));
}
