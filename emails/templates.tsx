import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

/**
 * Transactional email templates.
 *
 * ⚠️ These deliberately do NOT use the app's CSS custom properties. Email
 * clients strip <style> blocks and have no support for custom properties, so
 * every value here is an inline literal. That is the one place in this codebase
 * where hardcoded colours are correct.
 *
 * Dark mode is handled with `prefers-color-scheme` inside a <style> tag AND
 * safe inline defaults — Gmail ignores the media query, so the inline values
 * must already be legible on both a white and a dark background. That rules out
 * pure white or pure black anywhere.
 */

const BRAND = '#1d4ed8';
const TEXT = '#1f2933';
const MUTED = '#5b6672';
const BORDER = '#dfe3e8';
const SURFACE = '#f7f8fa';

const darkModeCss = `
  @media (prefers-color-scheme: dark) {
    .email-body { background: #16181d !important; }
    .email-card { background: #1f2229 !important; border-color: #333842 !important; }
    .email-text { color: #e8eaed !important; }
    .email-muted { color: #a8b0ba !important; }
    .email-code { background: #2a2e37 !important; color: #e8eaed !important; }
  }
`;

type ShellProps = {
  preview: string;
  heading: string;
  children: React.ReactNode;
};

function Shell({ preview, heading, children }: ShellProps) {
  return (
    <Html lang="en">
      <Head>
        <style dangerouslySetInnerHTML={{ __html: darkModeCss }} />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="email-body"
        style={{
          backgroundColor: SURFACE,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          margin: 0,
          padding: '32px 0',
        }}
      >
        <Container
          className="email-card"
          style={{
            backgroundColor: '#ffffff',
            border: `1px solid ${BORDER}`,
            borderRadius: '12px',
            margin: '0 auto',
            maxWidth: '520px',
            padding: '32px',
          }}
        >
          <Text
            className="email-text"
            style={{ color: TEXT, fontSize: '18px', fontWeight: 700, margin: '0 0 24px' }}
          >
            myaichat
          </Text>

          <Heading
            className="email-text"
            style={{ color: TEXT, fontSize: '20px', fontWeight: 600, margin: '0 0 16px' }}
          >
            {heading}
          </Heading>

          {children}

          <Hr style={{ borderColor: BORDER, margin: '28px 0 16px' }} />
          <Text className="email-muted" style={{ color: MUTED, fontSize: '12px', margin: 0 }}>
            If you did not expect this email you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ margin: '24px 0' }}>
      <Button
        href={href}
        style={{
          backgroundColor: BRAND,
          borderRadius: '8px',
          color: '#ffffff',
          display: 'inline-block',
          fontSize: '14px',
          fontWeight: 600,
          padding: '12px 20px',
          textDecoration: 'none',
        }}
      >
        {label}
      </Button>
    </Section>
  );
}

/** Shown under every button — some clients strip them, and some people distrust them. */
function FallbackLink({ href }: { href: string }) {
  return (
    <Text className="email-muted" style={{ color: MUTED, fontSize: '12px', margin: '0 0 8px' }}>
      Or paste this into your browser:
      <br />
      <span className="email-code" style={{ wordBreak: 'break-all' }}>
        {href}
      </span>
    </Text>
  );
}

export function WelcomeEmail({ confirmUrl }: { confirmUrl: string }) {
  return (
    <Shell preview="Confirm your myaichat account" heading="Confirm your email">
      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: 0 }}>
        Welcome to myaichat. Confirm your address and you can start chatting.
      </Text>
      <ActionButton href={confirmUrl} label="Confirm email" />
      <FallbackLink href={confirmUrl} />
    </Shell>
  );
}

export function PasswordResetEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <Shell preview="Reset your myaichat password" heading="Reset your password">
      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: 0 }}>
        Use the button below to choose a new password. The link expires in one hour.
      </Text>
      <ActionButton href={resetUrl} label="Reset password" />
      <FallbackLink href={resetUrl} />
    </Shell>
  );
}

export function MagicLinkEmail({ magicUrl }: { magicUrl: string }) {
  return (
    <Shell preview="Your myaichat sign-in link" heading="Sign in to myaichat">
      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: 0 }}>
        Click below to sign in. The link works once and expires shortly.
      </Text>
      <ActionButton href={magicUrl} label="Sign in" />
      <FallbackLink href={magicUrl} />
    </Shell>
  );
}

export function AdminAlertEmail({
  title,
  detail,
  occurredAt,
}: {
  title: string;
  detail: string;
  occurredAt: string;
}) {
  return (
    <Shell preview={title} heading={title}>
      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: '0 0 12px' }}>
        {detail}
      </Text>
      <Text
        className="email-code"
        style={{
          backgroundColor: SURFACE,
          borderRadius: '6px',
          color: MUTED,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '12px',
          margin: 0,
          padding: '10px 12px',
        }}
      >
        {occurredAt}
      </Text>
    </Shell>
  );
}

/**
 * Sent to an administrator when their account signs in from a device that has
 * not been seen before.
 *
 * Written so the recipient can decide in one glance. The recognisable case —
 * "that was me" — needs no action and the mail says so; the alarming case gets
 * a specific instruction rather than "contact support". A security email that
 * ends without telling you what to do is one you archive and forget.
 */
export function NewLoginEmail({
  when,
  ip,
  userAgent,
}: {
  when: string;
  ip: string;
  userAgent: string;
}) {
  return (
    <Shell preview="New sign-in to your myaichat admin account" heading="New sign-in">
      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: '0 0 12px' }}>
        Your <strong>administrator</strong> account was used to sign in from a device we have not
        seen before.
      </Text>

      <Text
        className="email-code"
        style={{
          backgroundColor: SURFACE,
          borderRadius: '6px',
          color: MUTED,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '12px',
          lineHeight: '1.7',
          margin: '0 0 16px',
          padding: '12px 14px',
        }}
      >
        When: {when}
        <br />
        Address: {ip}
        <br />
        Browser: {userAgent.slice(0, 120)}
      </Text>

      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: '0 0 8px' }}>
        <strong>If this was you</strong>, nothing to do — this address will not be flagged again.
      </Text>

      <Text className="email-text" style={{ color: TEXT, fontSize: '14px', margin: 0 }}>
        <strong>If it was not</strong>, change your password now. That signs out every session and
        invalidates the tokens behind them. Then check the audit log in the admin panel for anything
        you did not do, and rotate any provider key that may have been read.
      </Text>
    </Shell>
  );
}
