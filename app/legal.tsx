import Link from 'next/link';
import type { ReactNode } from 'react';

/** The two public legal pages share one plain, readable layout that needs no sign-in. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="legal-page">
      <p className="eyebrow">STAFF AI</p>
      <h1>{title}</h1>
      <p className="legal-updated">Last updated {updated}</p>
      {children}
      <p className="legal-footer">
        Questions: <a href="mailto:spencer@trystaff.ai">spencer@trystaff.ai</a> ·{' '}
        <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
      </p>
    </main>
  );
}
