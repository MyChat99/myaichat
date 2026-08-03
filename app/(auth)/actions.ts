'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/db/server';
import { isDisposableEmail } from '@/lib/security/disposable-domains';
import { checkSignupAllowed } from '@/lib/security/signup-policy';
import { signUpPasswordSchema } from '@/lib/security/password';
import { noteSignIn } from '@/lib/security/login-alert';
import { checkThrottle, clientIp, recordAttempt } from '@/lib/security/throttle';
import { redirectPathSchema, signUpSchema } from '@/lib/security/validation';

export type AuthState = { error: string | null };

/**
 * Auth errors are returned as one generic message on purpose: distinguishing
 * "no such account" from "wrong password" tells an attacker which emails are
 * registered.
 */
const GENERIC_CREDENTIALS_ERROR = 'Invalid email or password.';

/**
 * What a failed sign-up says.
 *
 * Never the upstream message. Two reasons, and the second is the important one:
 *
 *  - It is frequently unusable. Sign-ups are disabled at the Supabase project
 *    level on this deployment, and that surfaces as a 500 whose body is an
 *    empty object — so the user was shown the literal string `{}`.
 *  - It leaks. "User already registered" tells whoever asked that an address
 *    has an account here. The sign-IN path has always been careful about
 *    exactly that (see `GENERIC_CREDENTIALS_ERROR` above); sign-up was not, and
 *    it is the same disclosure by a different door.
 *
 * One message for every upstream failure. The reason a person can act on has
 * already been returned by then — the policy gate, the disposable-domain check
 * and the password rules all speak for themselves before this point.
 */
const GENERIC_SIGNUP_ERROR = 'This account could not be created. Ask an administrator for access.';

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

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);

  const throttle = await checkThrottle(parsed.data.email, ip, 'login');
  if (!throttle.allowed) {
    const minutes = Math.ceil(throttle.retryAfterSeconds / 60);
    return { error: `Too many failed attempts. Try again in ${minutes} minute(s).` };
  }

  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);

  await recordAttempt(parsed.data.email, ip, 'login', !error);

  if (error) return { error: GENERIC_CREDENTIALS_ERROR };

  /**
   * Alert an administrator signing in from an unrecognised device.
   *
   * Awaited rather than fire-and-forget: a Server Action's process can be torn
   * down the moment it returns, so a floating promise here would be dropped
   * often enough to make the alert unreliable — and an unreliable security
   * alert is worse than none, because it is trusted. `noteSignIn` never throws
   * and swallows its own failures, so this cannot break a login.
   */
  if (signedIn.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', signedIn.user.id)
      .maybeSingle();

    const userAgent = requestHeaders.get('user-agent') ?? 'unknown';

    const verdict = await noteSignIn({
      userId: signedIn.user.id,
      email: parsed.data.email,
      isAdmin: profile?.role === 'admin',
      ip,
      userAgent,
    });

    if (verdict.shouldAlert) {
      // Sent here rather than inside noteSignIn so the policy stays testable
      // without a mail transport. Failure is swallowed: an admin must not be
      // unable to sign in because Resend was briefly unreachable.
      const { sendNewLoginEmail } = await import('@/lib/email/send');
      await sendNewLoginEmail(parsed.data.email, {
        when: new Date().toISOString(),
        ip,
        userAgent,
      }).catch((err) => console.error('[login-alert] send failed:', err));
    }
  }

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

  /**
   * The policy gate, checked BEFORE the password rules.
   *
   * The admin panel has carried an "Allow new signups" switch since Phase 4 and
   * nothing read it: turning signups off left them on. Someone about to share
   * this link publicly would reasonably have relied on that switch.
   *
   * Ordered before the password check so a person on a domain that will never
   * be accepted is told that, rather than being asked to strengthen a password
   * for an account they cannot have.
   */
  const policy = await checkSignupAllowed(parsed.data.email);
  if (!policy.allowed) return { error: policy.reason };

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

  if (error) {
    // Logged with the upstream detail so an operator can diagnose it; the
    // caller gets the generic message.
    console.error('[signup] rejected by the auth service:', error.status, error.message);
    return { error: GENERIC_SIGNUP_ERROR };
  }

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
