'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/db/server';
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
  const parsed = signUpSchema
    .pick({ email: true, password: true })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return { error: GENERIC_CREDENTIALS_ERROR };

  const next = redirectPathSchema.parse(formData.get('next') ?? '/');
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) return { error: firstIssue(parsed.error) };

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
