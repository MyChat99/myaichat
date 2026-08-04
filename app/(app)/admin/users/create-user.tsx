'use client';

import { Check, Copy, UserPlus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createUserAccount } from '@/app/(app)/admin/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/press-confirm';

/**
 * Create an account without opening sign-ups.
 *
 * ## The password is shown once, and that is a promise the UI has to keep
 *
 * Nothing stores it. The server never returns it — it comes back from this
 * component's own state, because it was generated or typed here — and the
 * database holds only a hash. So "shown once" is not a policy that could be
 * relaxed later; there is genuinely nowhere to read it from afterwards, and the
 * copy says so in those terms rather than as a vague warning.
 *
 * ## Generation is client-side, from the platform CSPRNG
 *
 * `crypto.getRandomValues`, not `Math.random`, which is seeded predictably and
 * has no business anywhere near a credential. Four words and four digits: long
 * enough to satisfy the password rules, short enough to read down a phone line,
 * which is how one of these actually gets delivered.
 */

const WORDS = [
  'press',
  'ink',
  'paper',
  'plate',
  'folio',
  'quire',
  'signature',
  'proof',
  'galley',
  'stone',
  'roller',
  'type',
  'margin',
  'gutter',
  'rule',
  'stock',
];

function passphrase(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const pick = (i: number) => WORDS[bytes[i] % WORDS.length];
  const digits = String(((bytes[3] << 8) | bytes[4]) % 10_000).padStart(4, '0');
  return `${pick(0)}-${pick(1)}-${pick(2)}-${digits}`;
}

export function CreateUser() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();

  function submit() {
    void (async () => {
      const ok = await confirm({
        title: `Create an account for ${email.trim() || 'this address'}?`,
        body: 'They will be able to sign in immediately, as a regular user. The password is shown once and stored nowhere — copy it before closing.',
        confirmLabel: 'Create account',
      });
      if (!ok) return;

      startTransition(async () => {
        const result = await createUserAccount({
          email,
          password,
          displayName: displayName.trim() || undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setMade({ email: result.email, password });
        setEmail('');
        setPassword('');
        setDisplayName('');
      });
    })();
  }

  return (
    <>
      {dialog}

      {!open ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="mr-1.5 size-3.5" />
          Create user
        </Button>
      ) : (
        <section data-press="create-user">
          <p data-press="create-user-title">New account</p>

          {made ? (
            /*
             * The one and only sighting. Deliberately replaces the form rather
             * than sitting beside it: leaving the fields visible invites
             * "create another" before this one has been copied, and there is no
             * way back to it.
             */
            <div data-press="create-user-done">
              <p data-press="create-user-made">{made.email}</p>
              <p data-press="create-user-once">
                This password is shown once. It is stored nowhere — not in the database, not in the
                audit log. Copy it now.
              </p>
              <div data-press="create-user-secret">
                <code>{made.password}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(made.password).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  aria-label="Copy password"
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setMade(null);
                  setOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div>
                <Label htmlFor="new-email">Email</Label>
                <Input
                  id="new-email"
                  type="email"
                  required
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="new-password">Password</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-password"
                    type="text"
                    required
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {/* Shown as text, not a password field: the admin is meant to
                      read this one and pass it on. Masking it would only hide it
                      from the person who has to relay it. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPassword(passphrase())}
                  >
                    Generate
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="new-name">Display name (optional)</Label>
                <Input
                  id="new-name"
                  autoComplete="off"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <p data-press="create-user-note">
                Created as a regular user, active immediately. This form cannot create an
                administrator — promote from the table below, where it is re-authenticated and
                logged.
              </p>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || !email || !password}>
                  {pending ? 'Creating…' : 'Create account'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
