/**
 * The composer's client-side attachment rules.
 *
 * These run in the browser, so they are courtesy rather than security — the
 * presign route enforces the same table server-side and `verify:storage`
 * covers that. What this file protects is the OTHER failure: the two tables
 * drifting apart, so the picker accepts a file the server then refuses with an
 * error the user cannot act on.
 *
 * Credential-free — it imports no server module and needs no database, so it
 * runs in CI.
 *
 *   npm run verify:attachments
 */
import { ALLOWED_MIME as SERVER_TABLE } from '../lib/upload/types';
import {
  ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  describeAccepted,
  isAccepted,
  kindFor,
  rejectionReason,
} from '../lib/upload/types';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

const MB = 1024 * 1024;
const LIMIT = 20 * MB;

function file(name: string, type: string, size: number) {
  return { name, type, size };
}

console.log('Composer attachment rules\n');

console.log('Accepted types');
for (const mime of Object.keys(SERVER_TABLE)) {
  check(`accepts ${mime}`, isAccepted(mime));
  check(`  classifies ${mime}`, kindFor(mime) !== null);
}

console.log('\nRejections');

const rejected: [string, ReturnType<typeof file>, RegExp][] = [
  ['an executable', file('setup.exe', 'application/x-msdownload', 1024), /can't be attached/],
  ['an SVG (script-carrying)', file('logo.svg', 'image/svg+xml', 2048), /can't be attached/],
  ['a video', file('clip.mov', 'video/quicktime', 5 * MB), /can't be attached/],
  ['an HTML file', file('page.html', 'text/html', 900), /can't be attached/],
  ['a zip', file('bundle.zip', 'application/zip', 4 * MB), /can't be attached/],
  ['an empty but valid file', file('empty.txt', 'text/plain', 0), /empty/],
  ['an oversized image', file('huge.png', 'image/png', 40 * MB), /limit is 20MB/],
  ['a file with no MIME type', file('mystery', '', 500), /can't be attached/],
];

for (const [label, f, pattern] of rejected) {
  const reason = rejectionReason(f, LIMIT);
  check(`rejects ${label}`, reason !== null && pattern.test(reason), reason ?? 'was accepted');
}

console.log('\nAcceptances');
for (const f of [
  file('screenshot.png', 'image/png', 800 * 1024),
  file('notes.md', 'text/markdown', 4 * 1024),
  file('report.pdf', 'application/pdf', 19 * MB),
]) {
  check(`accepts ${f.name}`, rejectionReason(f, LIMIT) === null, String(rejectionReason(f, LIMIT)));
}

console.log('\nMessage wording');

// A rejection a user cannot act on is a rejection that generates a support
// ticket. Type errors must say what IS allowed.
const typeReason = rejectionReason(file('a.exe', 'application/x-msdownload', 10), LIMIT) ?? '';
check('a type rejection lists the accepted formats', /PNG|PDF/.test(typeReason), typeReason);

const sizeReason = rejectionReason(file('a.png', 'image/png', 40 * MB), LIMIT) ?? '';
check(
  'a size rejection states both actual and limit',
  /40\.0MB/.test(sizeReason) && /20MB/.test(sizeReason),
  sizeReason,
);

// Type is checked before size: "we don't take .mov" beats "that's too big" for
// a 200MB video, because shrinking it would not have helped.
const both = rejectionReason(file('big.mov', 'video/quicktime', 200 * MB), LIMIT) ?? '';
check('type is reported before size when both fail', /can't be attached/.test(both), both);

console.log('\nContracts');
check(
  'the picker accept attribute covers every allowed type',
  Object.keys(SERVER_TABLE).every((m) => ACCEPT_ATTRIBUTE.includes(m)),
);
check('the per-message cap matches the chat route (.max(5))', MAX_ATTACHMENTS_PER_MESSAGE === 5);
check(
  'the accepted list is human-readable',
  /^[A-Z0-9, ]+$/.test(describeAccepted()),
  describeAccepted(),
);

// No SVG, ever. It is an image to a user and a script host to a browser, and
// serving one from our own origin would be stored XSS.
check('SVG is absent from the allow-list', !('image/svg+xml' in SERVER_TABLE));
check('HTML is absent from the allow-list', !('text/html' in SERVER_TABLE));

console.log(
  failures === 0
    ? `\nAll ${checks} attachment checks passed.`
    : `\n${failures} of ${checks} attachment checks FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
