'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/feedback/error-state';

/**
 * Route-level error boundary.
 *
 * Catches render and data-fetch failures below the root layout, so a broken
 * page shows a themed message instead of Next's default screen.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route-error]', error);
  }, [error]);

  return <ErrorState digest={error.digest} onRetry={reset} />;
}
