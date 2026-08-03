import 'server-only';

import { render } from '@react-email/components';
import { Resend } from 'resend';

import {
  AdminAlertEmail,
  MagicLinkEmail,
  NewLoginEmail,
  PasswordResetEmail,
  WelcomeEmail,
} from '@/emails/templates';

/**
 * Transactional email.
 *
 * ⚠️ RESEND IS NOT CONFIGURED IN THIS ENVIRONMENT. `isEmailConfigured()` is the
 * single flag. When it is false, mail is RENDERED and logged rather than sent —
 * a console transport, which is standard for local development and means the
 * templates and the calling code are exercised for real. Only delivery is
 * faked. See ISSUES.md ISSUE-017 for what to add.
 */

export type EmailResult = { sent: boolean; transport: 'resend' | 'console'; error?: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY!);
  return resend;
}

async function deliver(to: string, subject: string, html: string): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    // Deliberately logs the subject and recipient but NOT the body: a magic
    // link in a log file is a live credential.
    console.info(`[email:console] to=${to} subject="${subject}" (${html.length} bytes, not sent)`);
    return { sent: false, transport: 'console' };
  }

  try {
    const { error } = await getResend().emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('[email] send failed:', error.message);
      return { sent: false, transport: 'resend', error: error.message };
    }
    return { sent: true, transport: 'resend' };
  } catch (err) {
    console.error('[email] send threw:', err);
    return {
      sent: false,
      transport: 'resend',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

export async function sendWelcomeEmail(to: string, confirmUrl: string): Promise<EmailResult> {
  const html = await render(WelcomeEmail({ confirmUrl }));
  return deliver(to, 'Confirm your Pilcrow account', html);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<EmailResult> {
  const html = await render(PasswordResetEmail({ resetUrl }));
  return deliver(to, 'Reset your Pilcrow password', html);
}

export async function sendMagicLinkEmail(to: string, magicUrl: string): Promise<EmailResult> {
  const html = await render(MagicLinkEmail({ magicUrl }));
  return deliver(to, 'Your Pilcrow sign-in link', html);
}

export async function sendNewLoginEmail(
  to: string,
  context: { when: string; ip: string; userAgent: string },
): Promise<EmailResult> {
  const html = await render(NewLoginEmail(context));
  return deliver(to, 'New sign-in to your Pilcrow admin account', html);
}

export async function sendAdminAlertEmail(
  to: string,
  title: string,
  detail: string,
): Promise<EmailResult> {
  const html = await render(
    AdminAlertEmail({ title, detail, occurredAt: new Date().toISOString() }),
  );
  return deliver(to, `[Pilcrow] ${title}`, html);
}
