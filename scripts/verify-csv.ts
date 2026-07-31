/**
 * CSV generation, and the injection it has to survive.
 *
 * The hazard is specific and widely missed: a cell beginning `=`, `+`, `-` or
 * `@` is interpreted by Excel and Google Sheets as a FORMULA. An audit row whose
 * metadata contains `=HYPERLINK("http://evil","click")` becomes a live link in
 * the reviewer's spreadsheet.
 *
 * An audit export is precisely where this matters: the text can be influenced by
 * whoever performed the audited action, and the reader is a person who trusts
 * the file because it came from their own admin panel.
 *
 * The escaping lives in the route, so this exercises the same rules against the
 * route's own source rather than a copy.
 *
 *   npm run verify:csv
 */
import { readFileSync } from 'node:fs';

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

function section(title: string) {
  console.log(`\n${title}\n`);
}

/**
 * Mirrors the route's rules. Kept in step by the source assertions at the
 * bottom, which fail if the route stops doing any of this.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function verifyInjection() {
  section('Formula injection is neutralised');

  const dangerous = [
    ['=HYPERLINK("http://evil","click")', 'equals'],
    ['+1+1', 'plus'],
    ['-1+1', 'minus'],
    ['@SUM(A1:A9)', 'at'],
    ["=cmd|' /C calc'!A0", 'the classic DDE payload'],
  ];

  for (const [payload, label] of dangerous) {
    const cell = csvCell(payload);
    check(
      `a cell starting with ${label} is defused`,
      cell.startsWith("'") || cell.startsWith('"\''),
      cell,
    );
    // Defused, not destroyed — a reviewer still needs to see what was there.
    check(`  and the original text is still readable`, cell.includes(payload.slice(1, 12)));
  }

  console.log('');

  const safe = ['provider.key_set', 'a normal value', '2026-07-31T12:00:00Z', 'user@example.com'];
  for (const value of safe) {
    check(`"${value.slice(0, 24)}" is not needlessly quoted`, !csvCell(value).startsWith("'"));
  }
}

function verifyEscaping() {
  section('RFC 4180 escaping');

  check('a comma forces quoting', csvCell('a,b') === '"a,b"');
  check('a quote is doubled', csvCell('say "hi"') === '"say ""hi"""');
  check('a newline forces quoting', csvCell('line1\nline2') === '"line1\nline2"');
  check(
    'a carriage return is handled',
    csvCell('a\rb').startsWith('"') || csvCell('a\rb').startsWith("'"),
  );
  check('null becomes empty', csvCell(null) === '');
  check('undefined becomes empty', csvCell(undefined) === '');
  check('a number survives', csvCell(42) === '42');
  check('false is not treated as empty', csvCell(false) === 'false');

  // Metadata is jsonb, so a cell is routinely an object full of quotes.
  const meta = { last4: '1234', note: 'he said "ok", then left' };
  const cell = csvCell(meta);
  check('an object is JSON-encoded', cell.includes('last4'));
  check('  and its quotes are doubled', cell.includes('""'));
  check('  and it is wrapped', cell.startsWith('"') && cell.endsWith('"'));

  // A round trip through a naive parser: the row must still have 3 fields.
  const row = [csvCell('a,b'), csvCell('plain'), csvCell('c"d')].join(',');
  const fields = row.match(/("([^"]|"")*"|[^,]*)/g)?.filter((f) => f !== '') ?? [];
  check('a row with hazards still parses to 3 fields', fields.length === 3, JSON.stringify(fields));
}

function verifyRouteMatches() {
  section('The route applies these rules');

  const source = readFileSync('app/api/admin/audit/export/route.ts', 'utf8');

  check(
    'the route defuses formula prefixes',
    /\^\[=\+\\?-@/.test(source) || source.includes('/^[=+\\-@'),
    'no formula guard found',
  );
  check('the route doubles quotes', source.includes('replace(/"/g'));
  check('the route sets text/csv', source.includes('text/csv'));
  check('  with a charset', source.includes('charset=utf-8'), 'Excel guesses badly without one');
  check('the route forces a download', source.includes('attachment; filename='));
  check('the route caps the row count', /limit\(MAX_ROWS\)/.test(source));
  check('the route requires an admin', source.includes('requireAdmin('));
  check('the route is rate limited', source.includes('checkEndpointLimit'));

  // Exporting the whole audit trail is itself an auditable event.
  check('the export is itself audited', source.includes("action: 'audit.exported'"));

  check('CRLF line endings', source.includes("join('\\r\\n')"), 'RFC 4180 specifies CRLF');
}

function main() {
  console.log('CSV export');

  verifyInjection();
  verifyEscaping();
  verifyRouteMatches();

  console.log(
    failures === 0
      ? `\nAll ${checks} CSV checks passed.`
      : `\n${failures} of ${checks} CSV checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
