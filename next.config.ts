import type { NextConfig } from 'next';

/**
 * Clerk serves its script and API from the instance's frontend host, which is encoded in the
 * publishable key (`pk_(test|live)_` + base64url of `<host>$`). Development instances live under
 * *.clerk.accounts.dev; a production instance uses a customer subdomain that no wildcard covers, so
 * the key has to be present when this config is loaded for that host to reach the policy.
 */
function clerkHost(): string[] {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const encoded = key?.replace(/^pk_(test|live)_/, '');
  if (!encoded || encoded === key) return [];
  const host = Buffer.from(encoded, 'base64url').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9.-]+$/i.test(host) ? [`https://${host}`] : [];
}

const development = process.env.NODE_ENV === 'development';

const clerk = ['https://*.clerk.accounts.dev', ...clerkHost()];
const convex = ['https://*.convex.cloud', 'wss://*.convex.cloud'];

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines its bootstrap and Clerk injects its own script tag. Neither can carry a nonce
  // without per-request rendering, so inline scripts stay allowed while script *origins* do not.
  // React needs eval in development for readable error stacks; production does not.
  `script-src 'self' 'unsafe-inline' ${development ? "'unsafe-eval' " : ''}${clerk.join(' ')}`,
  // react-three/drei's <Html> writes style attributes as it positions overlays in the office scene.
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
  'upgrade-insecure-requests',
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value:
              'accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
          },
          {
            // Report-only in development, where the dev server rewrites assets and the Clerk key is
            // often absent, so a blocked request never hides a real problem behind a policy error.
            key: development ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
};
export default config;
