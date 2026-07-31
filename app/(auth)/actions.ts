'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/db/server';
import { isDisposableEmail } from '@/lib/security/disposable-domains';
import { signUpPasswordSchema } from '@/lib/security/password';
import { checkThrottle, clientIp, recordAttempt } from '@/lib/security/throttle';
import { redirectPathSchema, signUpSchema } from '@/lib/security/validation';

export type AuthState = { error: string | null };

/**
 * Auth errors are returned as one generic message on purpose: distinguishing
 * "no such account" from "wrong password" tells an attacker which emails are
 * registered.
 */
const GENERIC_CREDENTIALS_ERROR = 'Invalid email or password.';

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? 'Check your details and try again.';
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // NOTE: the login path validates with the ORIGINAL password schema (8-char
  // minimum), not the stronger signup one. Raising the bar here would reject
  // every existing shorter password at the form before it was ever checked,
  // locking those accounts out of their own app. New passwords get the stronger
  // rules; old ones are migrated by a reset, not by a wall.
  const parsed = signUpSchema
    .pick({ email: true, password: true })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const ip = clientIp(await headers());

  const throttle = await checkThrottle(parsed.data.email, ip, 'login');
  if (!throttle.allowed) {
    const minutes = Math.ceil(throttle.retryAfterSeconds / 60);
    return { error: `Too many failed attempts. Try again in ${minutes} minute(s).` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  await recordAttempt(parsed.data.email, ip, 'login', !error);

  if (error) return { error: GENERIC_CREDENTIALS_ERROR };

  const next = redirectPathSchema.parse(formData.get('next') ?? '/');
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // Signup-only hardening, layered on top of the shared schema so the login
  // path is untouched. Order matters: the email check runs first so someone
  // using a throwaway domain is not asked to fix their password first.
  if (isDisposableEmail(parsed.data.email)) {
    return { error: 'Please sign up with a permanent email address.' };
  }

  const strength = signUpPasswordSchema.safeParse({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (!strength.success) return { error: firstIssue(strength.error) };

  const { email, password, displayName } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by the handle_new_user() trigger. Role is NOT taken from here —
      // the trigger hardcodes 'user' so this cannot be used to self-promote.
      data: displayName ? { display_name: displayName } : undefined,
    },
  });

  if (error) return { error: error.message };

  // With email confirmation enabled Supabase returns a user but no session.
  if (!data.session) {
    redirect('/login?checkEmail=1');
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
