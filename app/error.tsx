'use client';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#f7f5eb',
        color: '#294235',
      }}
    >
      <section style={{ maxWidth: 440 }}>
        <p style={{ fontSize: 12, letterSpacing: 2 }}>ASTRA HQ</p>
        <h1>We could not open your workspace.</h1>
        <p>
          The connection may have been interrupted. Try again, or check that sign-in and workspace services
          are configured.
        </p>
        <button className="primary-button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
