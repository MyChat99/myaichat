'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Shared error presentation.
 *
 * Deliberately never renders `error.message` from a server exception: Next
 * replaces those with a digest in production, and in development they can carry
 * internals a user should not see. The digest IS shown, because it is the only
 * thing that ties a user's report to a server log.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'This has been logged. Try again, and if it keeps happening the digest below will help track it down.',
  digest,
  onRetry,
}: {
  title?: string;
  description?: string;
  digest?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="bg-destructive/10 text-destructive rounded-full p-3">
        <AlertTriangle className="size-6" aria-hidden />
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      </div>

      {onRetry ? (
        <Button type="button" onClick={onRetry} variant="outline" size="sm">
          <RotateCw className="mr-1.5 size-3.5" />
          Try again
        </Button>
      ) : null}

      {digest ? (
        <p className="text-muted-foreground font-mono text-[11px]">Reference: {digest}</p>
      ) : null}
    </div>
  );
}
