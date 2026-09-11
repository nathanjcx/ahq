import type { Metadata } from 'next';
import './globals.css';

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
