'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { AuthState } from './actions';

type Mode = 'signin' | 'signup';

type Props = {
  mode: Mode;
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
  notice?: string;
};

const COPY = {
  signin: {
    title: 'Sign in',
    description: 'Welcome back.',
    submit: 'Sign in',
    pending: 'Signing in…',
    /**
     * Sign-ups are closed on this deployment, so "Create one" sent people to a
     * form that refuses them. Stating the policy is kinder than offering a door
     * that does not open. /signup stays functional for when it reopens — this
     * is copy, not a route change.
     */
    footer: 'Accounts are by invitation.',
    footerHref: undefined,
    footerLink: undefined,
  },
  signup: {
    title: 'Create account',
    description: 'Start chatting in a minute.',
    submit: 'Create account',
    pending: 'Creating account…',
    footer: 'Already have an account?',
    footerHref: '/login',
    footerLink: 'Sign in',
  },
} as const;

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? COPY[mode].pending : COPY[mode].submit}
    </Button>
  );
}

export function AuthForm({ mode, action, next, notice }: Props) {
  const [state, formAction] = useActionState<AuthState, FormData>(action, { error: null });
  const copy = COPY[mode];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {notice ? (
          <p
            role="status"
            className="border-success/30 bg-success/10 mb-4 rounded-md border px-3 py-2 text-sm"
          >
            {notice}
          </p>
        ) : null}

        <form action={formAction} className="space-y-4" noValidate>
          {next ? <input type="hidden" name="next" value={next} /> : null}

          {mode === 'signup' ? (
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input id="displayName" name="displayName" autoComplete="name" maxLength={60} />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              // Signup only. The login field keeps the old minimum, because a
              // stricter rule here would block existing accounts with shorter
              // passwords from even submitting the form.
              minLength={mode === 'signup' ? 10 : 8}
              required
              aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
            />
            {mode === 'signup' ? (
              <p id="password-hint" className="text-muted-foreground text-xs">
                At least 10 characters. Length beats symbols — a short phrase you can remember is
                stronger than <code>P@ssw0rd</code>, and common passwords are rejected.
              </p>
            ) : null}
          </div>

          {state.error ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}

          <SubmitButton mode={mode} />
        </form>

        {/* A footer with no link is a statement, not an invitation to click.
            Sign-in says "Accounts are by invitation."; sign-up still links back
            to sign-in, so the pair is not a dead end. */}
        <p className="text-muted-foreground mt-6 text-center text-sm">
          {copy.footer}
          {copy.footerHref && copy.footerLink ? (
            <>
              {' '}
              <Link href={copy.footerHref} className="text-foreground underline underline-offset-4">
                {copy.footerLink}
              </Link>
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
