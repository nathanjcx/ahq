import { applyResponseHeaders, authkit, partitionAuthkitHeaders } from '@workos-inc/authkit-nextjs';
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, nonceValue } from './lib/server/csp';
import { authConfigured } from './lib/server/workos';

const development = process.env.NODE_ENV === 'development';

/**
 * AuthKit hands the proxy a pending PKCE verifier cookie for the redirect to WorkOS it would make in
 * `middlewareAuth` mode. This application signs in through `/sign-in`, which mints its own verifier,
 * so a pending one here is an orphan — and AuthKit keeps at most five, so orphans would eventually
 * evict the real one. Session cookies set by a refresh are kept.
 */
const PENDING_VERIFIER = 'wos-auth-verifier';

function dropPendingVerifier(headers: Headers) {
  const cookies = headers.getSetCookie().filter((cookie) => !cookie.startsWith(PENDING_VERIFIER));
  headers.delete('set-cookie');
  for (const cookie of cookies) headers.append('set-cookie', cookie);
}

/**
 * One fresh nonce per request. It travels two ways: on the request, where Next.js parses the policy
 * to stamp its bootstrap and bundle tags, and on the response, where the browser enforces it. Both
 * headers are set, never merged, so a caller cannot smuggle its own `x-nonce` in.
 *
 * The same pass reads the AuthKit session and refreshes it when it is close to expiry, which is what
 * puts the sealed session on the request for `withAuth()` to read. Without WorkOS credentials that
 * step is skipped and the proxy is only the content policy, so the interface still renders.
 */
export default async function proxy(request: NextRequest) {
  const nonce = nonceValue();
  const policy = contentSecurityPolicy({ nonce, development });

  let requestHeaders = new Headers(request.headers);
  let responseHeaders = new Headers();
  if (authConfigured()) {
    const { headers } = await authkit(request);
    dropPendingVerifier(headers);
    ({ requestHeaders, responseHeaders } = partitionAuthkitHeaders(request, headers));
  }
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = applyResponseHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    responseHeaders,
  );
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
