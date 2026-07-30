import type { Metadata } from 'next';

import { redirectPathSchema } from '@/lib/security/validation';

import { signIn } from '../actions';
import { AuthForm } from '../auth-form';

export const metadata: Metadata = { title: 'Sign in · myaichat' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; checkEmail?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ? redirectPathSchema.parse(params.next) : undefined;

  return (
    <AuthForm
      mode="signin"
      action={signIn}
      next={next}
      notice={
        params.checkEmail ? 'Check your email to confirm your account, then sign in.' : undefined
      }
    />
  );
}
