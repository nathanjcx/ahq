import type { Metadata } from 'next';
import './globals.css';

/**
 * A nonce-based CSP only works on per-request renders: a prerendered page would carry a nonce from
 * build time, which no request's policy matches. Forcing dynamic rendering here covers every page
 * under the root layout, including the QA fixture.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Astra HQ',
  description: 'A calm place to direct your AI workforce.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
