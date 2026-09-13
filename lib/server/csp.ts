/**
 * The one Content-Security-Policy this application serves. The proxy builds it per request with a
 * fresh nonce, so `script-src` never needs `'unsafe-inline'`: Next.js reads the nonce out of the
 * request's policy and stamps it on its own bootstrap and bundle tags.
 *
 * WorkOS AuthKit needs no origin here. Signing in is a top-level navigation to WorkOS and back to
 * `/callback`, and the session is read on the server, so the browser never loads a script, an iframe,
 * or a fetch from WorkOS. Only Convex is contacted cross-origin.
 */

export function nonceValue(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

export function contentSecurityPolicy(options: { nonce: string; development?: boolean }): string {
  const { nonce, development = false } = options;
  const convex = ['https://*.convex.cloud', 'wss://*.convex.cloud'];
  return [
    "default-src 'self'",
    // React needs eval in development for readable error stacks.
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ''}`,
    // Inline *style attributes* are not covered by a nonce, and this app renders them: the error
    // boundary and several components set `style={{…}}`, and react-three/drei's <Html> positions
    // its office overlays by writing style attributes. Dropping this needs 'unsafe-hashes' plus a
    // hash per attribute, which buys nothing while script-src is nonce-locked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' https:",
    `connect-src 'self' ${convex.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
