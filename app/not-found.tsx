import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

/**
 * 404. Rendered inside the root layout, so it inherits the user's theme rather
 * than flashing an unstyled default.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="bg-muted text-muted-foreground rounded-full p-3">
        <FileQuestion className="size-6" aria-hidden />
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          This page does not exist, or it belongs to someone else&apos;s account.
        </p>
      </div>

      <Link
        href="/"
        className="border-border hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition"
      >
        Back to chat
      </Link>
    </div>
  );
}
