/**
 * Proves the four transactional email templates render correctly.
 *
 * Separate from verify:storage because they cannot share a process: storage
 * imports `server-only`, which needs Node's `react-server` condition, and that
 * condition makes `react-dom/server` — which React Email requires — unavailable.
 *
 * Resend is unconfigured here, so DELIVERY is not covered; the console
 * transport is exercised instead. See PROGRESS.md for what needs a human.
 *
 *   npm run verify:email
 */
import { render } from '@react-email/components';

import {
  AdminAlertEmail,
  MagicLinkEmail,
  PasswordResetEmail,
  WelcomeEmail,
} from '../emails/templates';

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

async function main() {
  console.log('Email templates\n');

  const rendered: Record<string, string> = {
    welcome: await render(WelcomeEmail({ confirmUrl: 'https://example.com/confirm?t=abc' })),
    reset: await render(PasswordResetEmail({ resetUrl: 'https://example.com/reset?t=abc' })),
    magic: await render(MagicLinkEmail({ magicUrl: 'https://example.com/magic?t=abc' })),
    alert: await render(
      AdminAlertEmail({ title: 'Key test failed', detail: 'anthropic', occurredAt: 'now' }),
    ),
  };

  for (const [name, html] of Object.entries(rendered)) {
    check(`${name}: renders HTML`, html.includes('<html') && html.length > 500);

    // Gmail ignores the media query, so inline values must already work on both
    // backgrounds. Pure black or white text is what breaks in exactly one mode.
    check(`${name}: declares dark-mode styles`, html.includes('prefers-color-scheme: dark'));
    check(`${name}: avoids pure black text`, !/color:\s*#000000/i.test(html));

    // White text is correct ON a coloured background (the CTA button) and broken
    // anywhere else, because a client that ignores the media query may leave the
    // surface light. So the assertion is not "no white text" — it is "no white
    // text that lacks its own background colour", which is the condition that
    // actually renders something invisible.
    // NOTE the `(?<!-)`: without it this matches inside `background-color:`,
    // which ends with the literal `color:`. That false positive flagged the
    // card's white BACKGROUND as white TEXT.
    const styleAttrs = html.match(/style="[^"]*"/gi) ?? [];
    const strandedWhite = styleAttrs.filter(
      (attr) =>
        /(?<!-)color:\s*#(fff|ffffff)\b/i.test(attr) && !/background-color:\s*#(?!fff)/i.test(attr),
    );
    check(
      `${name}: no white text without its own background`,
      strandedWhite.length === 0,
      strandedWhite[0]?.slice(0, 90),
    );

    // Inline styles are mandatory — clients strip <style> blocks.
    check(`${name}: uses inline styles`, html.includes('style="'));
  }

  check('welcome carries its action link', rendered.welcome.includes('example.com/confirm'));
  check('reset carries its action link', rendered.reset.includes('example.com/reset'));
  check('alert carries its detail', rendered.alert.includes('anthropic'));

  // A button-only email is unusable in clients that strip buttons, so every
  // action link must also appear as copyable text.
  for (const [name, url] of [
    ['welcome', 'example.com/confirm'],
    ['reset', 'example.com/reset'],
    ['magic', 'example.com/magic'],
  ] as const) {
    const occurrences = (rendered[name].match(new RegExp(url.replace('.', '\\.'), 'g')) ?? [])
      .length;
    check(`${name}: link appears as text as well as a button`, occurrences >= 2, `${occurrences}x`);
  }

  console.log(
    failures === 0 ? `\nAll email checks passed.` : `\n${failures} email check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-email crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
