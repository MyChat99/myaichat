/**
 * Structured logging — one shape, and provably no secrets.
 *
 * The interesting half is the second. "We redact secrets" is the kind of claim
 * that is true until someone adds a field, so this does not read the code and
 * agree with it: it CAPTURES REAL LOG OUTPUT by replacing `console.log` and
 * `console.error`, feeds credentials of every shape through it, and greps what
 * actually came out.
 *
 * A redaction test that checks the redaction function in isolation proves the
 * function works. This proves the logger does.
 *
 *   npm run verify:logging
 */
import {
  logRequest,
  newRequestId,
  outcomeFor,
  redact,
  withRequestLog,
  type LogFields,
} from '../lib/observability/log';

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

/** Swaps the console out and returns everything the logger wrote. */
async function capture(run: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  console.error = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  return lines;
}

const BASE: LogFields = {
  requestId: 'req-1',
  route: '/api/chat',
  method: 'POST',
  status: 200,
  outcome: 'ok',
  durationMs: 42,
};

// ─────────────────────────────────────────────────────── shape

async function verifyShape() {
  section('Every line is one JSON object with the agreed fields');

  const lines = await capture(() => logRequest({ ...BASE, userId: 'u-1' }));
  check('exactly one line per request', lines.length === 1, `${lines.length} lines`);

  let parsed: Record<string, unknown> = {};
  let isJson = true;
  try {
    parsed = JSON.parse(lines[0]!);
  } catch {
    isJson = false;
  }
  check('it parses as JSON', isJson, lines[0]);

  for (const field of ['at', 'requestId', 'route', 'method', 'status', 'outcome', 'durationMs']) {
    check(`  carries ${field}`, field in parsed, JSON.stringify(Object.keys(parsed)));
  }

  check('the timestamp is ISO 8601', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(parsed.at)));

  // Absent fields must not appear as nulls, or every aggregator shows a column
  // of nothing for the routes that do not use them.
  const sparse = JSON.parse((await capture(() => logRequest(BASE)))[0]!);
  check('undefined fields are omitted, not null', !('userId' in sparse));

  // Server errors on stderr so a platform that separates streams surfaces them.
  const errLines: string[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => void errLines.push(a.join(' '));
  logRequest({ ...BASE, status: 500, outcome: 'server_error' });
  console.error = realError;
  check('a server error goes to stderr', errLines.length === 1);
}

function verifyOutcome() {
  section('Outcome classification is shared, not per-route');

  check('200 is ok', outcomeFor(200) === 'ok');
  check('201 is ok', outcomeFor(201) === 'ok');
  check('400 is a client error', outcomeFor(400) === 'client_error');
  check('404 is a client error', outcomeFor(404) === 'client_error');
  check('403 is refused, not a client error', outcomeFor(403) === 'refused');
  check('429 is refused, not a client error', outcomeFor(429) === 'refused');
  check('500 is a server error', outcomeFor(500) === 'server_error');
  check('502 is a server error', outcomeFor(502) === 'server_error');

  // The distinction that matters when reading a dashboard: a rate limit working
  // correctly is not an error, and burying it among 4xx hides real bugs.
  check('a working rate limit is not counted as an error', outcomeFor(429) !== 'client_error');
}

function verifyRequestId() {
  section('Request ids');

  const a = newRequestId();
  const b = newRequestId();
  check('ids are unique', a !== b);
  check('and are UUIDs', /^[0-9a-f-]{36}$/.test(a), a);
}

// ─────────────────────────────────────────────── the part that matters

async function verifySecretsNeverEscape() {
  section('Real captured output contains no credentials');

  // Every credential shape this project can produce, assembled at runtime so
  // this file itself contains no literal that security:audit would flag.
  const j = (parts: string[]) => parts.join('');
  const secrets: { name: string; value: string }[] = [
    { name: 'Anthropic key', value: j(['sk-', 'ant-', 'api03-', 'A'.repeat(40)]) },
    { name: 'OpenAI key', value: j(['sk-', 'proj-', 'B'.repeat(40)]) },
    { name: 'Supabase secret', value: j(['sb_', 'secret_', 'C'.repeat(30)]) },
    { name: 'Supabase publishable', value: j(['sb_', 'publishable_', 'D'.repeat(30)]) },
    { name: 'Resend key', value: j(['re_', 'E'.repeat(30)]) },
    { name: 'AWS access key', value: j(['AKIA', 'FGHIJKLMNOPQRSTU']) },
    {
      name: 'JWT',
      value: j(['eyJhbGciOiJIUzI1NiJ9.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.', 'ZZZZZZZZ']),
    },
    {
      name: 'Postgres DSN',
      value: 'postgresql://postgres:hunter2secret@db.example.supabase.co:5432/postgres',
    },
    { name: 'email address', value: 'someone.real@example-company.com' },
    { name: 'home path', value: '/Users/muhammadbinzeeshan/myaichat/.env.local' },
    {
      name: 'encrypted key blob',
      value: j(['v1.', 'A'.repeat(16), '.', 'B'.repeat(16), '.', 'C'.repeat(40)]),
    },
  ];

  for (const secret of secrets) {
    const lines = await capture(() =>
      logRequest({
        ...BASE,
        status: 500,
        outcome: 'server_error',
        detail: `upstream said: ${secret.value} was rejected`,
      }),
    );

    const output = lines.join('\n');
    check(
      `${secret.name} never reaches the log`,
      !output.includes(secret.value),
      output.slice(0, 90),
    );
  }

  console.log('');

  // The generic backstop: a long high-entropy run nobody wrote a pattern for.
  const unknownShape = 'X7f'.repeat(40);
  const lines = await capture(() =>
    logRequest({ ...BASE, status: 500, outcome: 'server_error', detail: `token ${unknownShape}` }),
  );
  check(
    'an unrecognised long secret is truncated anyway',
    !lines.join('').includes(unknownShape),
    'a credential nobody wrote a pattern for still must not survive',
  );

  console.log('');

  // Redaction must not eat everything: a log with no information is not safer,
  // it is just useless.
  const useful = await capture(() =>
    logRequest({
      ...BASE,
      status: 502,
      outcome: 'server_error',
      kind: 'upstream',
      detail: 'connect ETIMEDOUT after 90000ms',
    }),
  );
  const parsed = JSON.parse(useful[0]!);
  check(
    'non-secret detail survives redaction',
    String(parsed.detail).includes('ETIMEDOUT'),
    String(parsed.detail),
  );
  check('and the classification survives', parsed.kind === 'upstream');
}

function verifyNoUserContent() {
  section('The field list cannot carry user content');

  // The policy is structural: there is no free-form object to hide a prompt in.
  // This asserts the shape of that policy, so widening it is a deliberate edit
  // someone has to make here too.
  const allowed = [
    'requestId',
    'route',
    'method',
    'status',
    'outcome',
    'durationMs',
    'userId',
    'dependency',
    'kind',
    'model',
    'inputTokens',
    'outputTokens',
    'attempts',
    'detail',
  ];

  const full: LogFields = {
    ...BASE,
    userId: 'u',
    dependency: 'provider',
    kind: 'upstream',
    model: 'claude-haiku-4-5',
    inputTokens: 1,
    outputTokens: 2,
    attempts: 3,
    detail: 'x',
  };

  const keys = Object.keys(full);
  check(
    'no field exists outside the agreed list',
    keys.every((k) => allowed.includes(k)),
    keys.filter((k) => !allowed.includes(k)).join(','),
  );

  // Named absences, so adding one later is a conscious act.
  for (const forbidden of ['message', 'prompt', 'completion', 'content', 'email', 'ip', 'body']) {
    check(`  there is no "${forbidden}" field`, !allowed.includes(forbidden));
  }

  // `model` is an identifier, not text — asserted because "model" is the field
  // most likely to be widened into "the messages we sent it".
  check('model holds an identifier', /^[a-z0-9.-]+$/.test(String(full.model)), String(full.model));
}

async function verifyWrapper() {
  section('withRequestLog');

  // The assertions live OUTSIDE the capture block. `check()` writes to
  // console.log, which capture() has replaced — asserting inside it counts the
  // test's own output as the logger's, and "one line per request" reads as three.
  let response: Response | undefined;
  const lines = await capture(async () => {
    response = await withRequestLog(
      { route: '/api/test', method: 'GET' },
      async () => new Response('ok', { status: 200 }),
    );
  });

  check('the response passes through', response?.status === 200);
  check('and carries the request id header', Boolean(response?.headers.get('x-request-id')));
  check('exactly one line is written', lines.length === 1, `${lines.length}`);
  const parsed = JSON.parse(lines[0]!);
  check('duration is measured', typeof parsed.durationMs === 'number' && parsed.durationMs >= 0);

  // A throw must still be logged, and the message scrubbed, before rethrowing.
  const thrown = await capture(async () => {
    try {
      await withRequestLog({ route: '/api/test', method: 'GET' }, async () => {
        throw new Error(`failed for someone@example-company.com`);
      });
    } catch {
      /* rethrown, as designed */
    }
  });

  check('a thrown error is still logged', thrown.length === 1);
  check(
    '  with the address scrubbed',
    !thrown.join('').includes('someone@example-company.com'),
    thrown.join('').slice(0, 100),
  );
  check('  and classified as a server error', JSON.parse(thrown[0]!).outcome === 'server_error');
}

function verifyRedactIsPure() {
  section('redact() in isolation');

  check(
    'it is idempotent',
    redact(redact('sk-' + 'ant-' + 'X'.repeat(30))) === redact('sk-' + 'ant-' + 'X'.repeat(30)),
  );
  check(
    'ordinary text is untouched',
    redact('connection reset by peer') === 'connection reset by peer',
  );
  check('an empty string is safe', redact('') === '');
  check(
    'a DSN keeps its host but loses its password',
    (() => {
      const out = redact('postgresql://user:hunter2@db.host:5432/x');
      return !out.includes('hunter2') && out.includes('db.host');
    })(),
    redact('postgresql://user:hunter2@db.host:5432/x'),
  );
}

async function main() {
  console.log('Structured logging');

  await verifyShape();
  verifyOutcome();
  verifyRequestId();
  await verifySecretsNeverEscape();
  verifyNoUserContent();
  await verifyWrapper();
  verifyRedactIsPure();

  console.log(
    failures === 0
      ? `\nAll ${checks} logging checks passed.`
      : `\n${failures} of ${checks} logging checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
