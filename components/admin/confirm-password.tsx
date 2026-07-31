'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Re-authentication prompt for privileged admin actions.
 *
 * ⚠️ This is the PROMPT, not the control. Every action behind it calls
 * `requireAdminWithPassword()` server-side, which re-verifies the password on a
 * throwaway client and is itself throttled. A Server Action is a POST endpoint —
 * anything enforced only in the component that calls it is not enforced at all.
 *
 * Exists because there are now several of these. The provider-key form grew its
 * own inline fields first; rather than write a third bespoke one, this is the
 * shared version. The provider form is deliberately left alone — it works, and
 * rewriting working code to share a component is not a good enough reason.
 */

export type ConfirmRequest = {
  /** Shown as the question. Say exactly what is about to happen. */
  title: string;
  /** The consequence, in the user's terms. */
  detail?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Resolves with the typed password. Return an error string to keep it open. */
  onConfirm: (password: string) => Promise<string | null>;
};

export function useConfirmPassword() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return {
    request,
    ask: (r: ConfirmRequest) => setRequest(r),
    close: () => setRequest(null),
  };
}

/**
 * Outer shell: renders nothing until there is a request.
 *
 * The state lives in `Prompt` below, which therefore MOUNTS FRESH for each
 * request. That is deliberate — the alternative is an effect that clears the
 * password and error whenever the request changes, which is `setState` inside an
 * effect body: a cascading render, and the thing React's rules-of-hooks lint
 * correctly refuses. Remounting is both simpler and impossible to get wrong.
 */
export function ConfirmPasswordDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  if (!request) return null;
  return <Prompt request={request} onClose={onClose} />;
}

function Prompt({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mount-only: take focus, and hand it back to whatever had it on unmount.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await request.onConfirm(password);
      if (message) {
        // Wrong password: clear it, keep the dialog and the context.
        setPassword('');
        setError(message);
        inputRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="bg-background w-full max-w-sm rounded-xl border p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-full ${
              request.destructive
                ? 'bg-destructive/10 text-destructive'
                : 'bg-primary/10 text-primary'
            }`}
          >
            <AlertTriangle className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-sm font-semibold">
              {request.title}
            </h2>
            {request.detail ? (
              <p className="text-muted-foreground mt-1 text-xs">{request.detail}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Confirm with your password"
            aria-label="Your account password"
            aria-invalid={Boolean(error)}
          />
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Asked again so a session left open on an unlocked screen cannot do this.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={request.destructive ? 'destructive' : 'default'}
            disabled={!password || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Checking…' : request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
