import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, nonceValue } from './lib/server/csp';

const development = process.env.NODE_ENV === 'development';

/**
 * One fresh nonce per request. It travels two ways: on the request, where Next.js parses the policy
 * to stamp its bootstrap and bundle tags and Clerk reads `x-nonce` for its script tags, and on the
 * response, where the browser enforces it. Both headers are set, never merged, so a caller cannot
 * smuggle its own `x-nonce` in.
 */
function withPolicy(request: NextRequest) {
  const nonce = nonceValue();
  const policy = contentSecurityPolicy({ nonce, development });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export default process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  ? clerkMiddleware((_auth, request) => withPolicy(request))
  : withPolicy;

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
