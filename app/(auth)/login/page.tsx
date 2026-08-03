import type { Metadata } from 'next';

import { redirectPathSchema } from '@/lib/security/validation';

import { signIn } from '../actions';
import { AuthForm } from '../auth-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; checkEmail?: string; suspended?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ? redirectPathSchema.parse(params.next) : undefined;

  return (
    <AuthForm
      mode="signin"
      action={signIn}
      next={next}
      notice={
        /* Suspension first: someone bounced here from a page they were using
           needs to know why more than they need a confirmation reminder. It
           names no reason, because the reason is between them and the
           administrator and this form is shown to anyone who types the URL. */
        params.suspended
          ? 'This account has been suspended. Contact an administrator.'
          : params.checkEmail
            ? 'Check your email to confirm your account, then sign in.'
            : undefined
      }
    />
  );
}
