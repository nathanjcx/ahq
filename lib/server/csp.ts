/**
 * The one Content-Security-Policy this application serves. The proxy builds it per request with a
 * fresh nonce, so `script-src` never needs `'unsafe-inline'`: Next.js reads the nonce out of the
 * request's policy and stamps it on its own bootstrap and bundle tags, and Clerk's App Router
 * provider reads the `x-nonce` request header for its script tags.
 */

/**
 * Clerk serves its script and API from the instance's frontend host, which is encoded in the
 * publishable key (`pk_(test|live)_` + base64url of `<host>$`). Development instances live under
 * *.clerk.accounts.dev; a production instance uses a customer subdomain that no wildcard covers, so
 * the key has to be present for that host to reach the policy.
 */
function clerkHost(): string[] {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const encoded = key?.replace(/^pk_(test|live)_/, '');
  if (!encoded || encoded === key) return [];
  const host = Buffer.from(encoded, 'base64url').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9.-]+$/i.test(host) ? [`https://${host}`] : [];
}

export function nonceValue(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

export function contentSecurityPolicy(options: { nonce: string; development?: boolean }): string {
  const { nonce, development = false } = options;
  const clerk = ['https://*.clerk.accounts.dev', ...clerkHost()];
  const convex = ['https://*.convex.cloud', 'wss://*.convex.cloud'];
  return [
    "default-src 'self'",
    // No `'strict-dynamic'`: it would void the Clerk origins below, and Clerk's script tag is a
    // plain `src` on that host. React needs eval in development for readable error stacks.
    `script-src 'self' 'nonce-${nonce}' ${development ? "'unsafe-eval' " : ''}${clerk.join(' ')}`,
    // Inline *style attributes* are not covered by a nonce, and this app renders them: the error
    // boundary and several components set `style={{…}}`, and react-three/drei's <Html> positions
    // its office overlays by writing style attributes. Dropping this needs 'unsafe-hashes' plus a
    // hash per attribute, which buys nothing while script-src is nonce-locked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' https:",
    `connect-src 'self' ${[...clerk, ...convex].join(' ')}`,
    "worker-src 'self' blob:",
    `frame-src 'self' ${clerk.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
