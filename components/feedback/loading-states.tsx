import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading states.
 *
 * These are shaped like the content they replace — same widths, same rhythm —
 * because a skeleton that does not match causes a visible jolt when the real
 * content lands, which is worse than a spinner. Each is wrapped in a live
 * region so a screen reader is told the page is working rather than being
 * read a wall of empty boxes.
 */

function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <Loading label="Loading conversation">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <Skeleton className="h-10 w-2/5 rounded-2xl" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-7/12" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Loading label="Loading">
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <div className="border-border divide-border divide-y rounded-lg border">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4 p-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Loading label="Loading">
      <div className="space-y-6">
        <Skeleton className="h-7 w-36" />
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        ))}
        <Skeleton className="h-9 w-28" />
      </div>
    </Loading>
  );
}
