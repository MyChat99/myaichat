'use client';

/**
 * Last-resort boundary: catches failures in the ROOT layout itself, which
 * app/error.tsx cannot reach because it renders inside that layout.
 *
 * It must supply its own <html> and <body>, and cannot use theme tokens — the
 * layout that defines them is precisely what failed. Hence the inline styles
 * and the neutral palette that reads on both light and dark.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '2rem',
          background: '#f7f8fa',
          color: '#1f2933',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            The application failed to load
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#5b6672', margin: '0 0 1.5rem' }}>
            Something went wrong before the page could render.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#1d4ed8',
              border: 0,
              borderRadius: '0.5rem',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '0.875rem',
              padding: '0.625rem 1rem',
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ color: '#5b6672', fontSize: '0.75rem', marginTop: '1.5rem' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
