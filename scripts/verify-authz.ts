/**
 * Every server entry point must authorise before it acts.
 *
 * This is a COMPLETENESS check, and that is the point. The runtime suites
 * (`verify:gates`, `verify:admin`, `verify:rls`) prove that the endpoints they
 * know about are gated; none of them can notice a *new* Server Action shipped
 * without a gate, because a test only covers what someone remembered to write.
 * This walks the source instead, so the failure mode "added an admin action,
 * forgot `requireAdmin()`" is caught the first time it happens.
 *
 * It reads files rather than importing them: importing a Server Action module
 * pulls in `server-only`, the Next request context and the database client, none
 * of which exist in a plain script. Source inspection is the cruder tool and the
 * one that actually runs credential-free in CI.
 *
 *   npm run verify:authz
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

/** Any of these, called anywhere in the body, counts as authorising. */
const GATES = ['requireAdmin(', 'requireAdminWithPassword(', 'requireUser(', 'auth.getUser('];

/**
 * Routes that are intentionally reachable without a session. Each one needs a
 * reason, because "it's fine" is how an ungated endpoint gets waved through.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'app/api/health/route.ts':
    'liveness probe for Railway — returns no user data and is called before any session exists',
  'app/auth/confirm/route.ts':
    'email confirmation link — the token in the URL is the credential, so a session cannot be required',
  'app/api/ping/route.ts':
    'database keep-alive — the failure it prevents is nobody signing in for a week, so requiring a session would silence it exactly when it matters. It reads and at most writes one timestamp, at most once per six hours however much traffic arrives, returns only { ok } and records nothing about the caller',
};

/**
 * Exported functions in an actions file that legitimately need no gate. Sign-in
 * and sign-up ARE the authentication boundary; requiring a session to reach
 * them would be circular.
 */
const UNGATED_ACTIONS = new Set(['signIn', 'signUp', 'signOut']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * Returns every function in the file with its body — exported or not.
 *
 * Brace counting, not a parser: pulling a TypeScript AST into a verification
 * script is more machinery than the job needs on files that already compile.
 * Two details are NOT optional, though, because getting either wrong produces
 * confident false positives:
 *
 *  1. The body's opening brace is found at angle-bracket depth zero. A return
 *     type like `Promise<{ ok: true }>` contains a `{` that appears first, and
 *     naively taking it makes the "body" two tokens long — which then reports
 *     a perfectly well-gated action as ungated.
 *  2. Non-exported functions are collected too, so a gate reached through a
 *     local helper still counts. See `resolveGate` below.
 */
function functionsIn(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const paramsStart = source.indexOf('(', match.index);
    if (paramsStart === -1) continue;

    // Walk the parameter list to its closing paren.
    let parenDepth = 0;
    let cursor = paramsStart;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === '(') parenDepth++;
      else if (source[cursor] === ')') {
        parenDepth--;
        if (parenDepth === 0) break;
      }
    }

    // Then to the body brace, ignoring anything inside a generic.
    let angleDepth = 0;
    let start = -1;
    for (let i = cursor + 1; i < source.length; i++) {
      const c = source[i];
      if (c === '<') angleDepth++;
      else if (c === '>') angleDepth = Math.max(0, angleDepth - 1);
      else if (c === '{' && angleDepth === 0) {
        start = i;
        break;
      }
    }
    if (start === -1) continue;

    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    found.set(match[1]!, source.slice(start, end + 1));
  }

  return found;
}

function exportedNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /export\s+async\s+function\s+(\w+)/g;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) names.push(m[1]!);
  return names;
}

/**
 * True if the function gates directly, or calls a same-file helper that does.
 *
 * One level of indirection, deliberately: `createConversation()` delegating to
 * a local `insertConversation()` that calls `requireUser()` is a real gate and
 * flagging it would train everyone to ignore this script. Chasing gates across
 * module boundaries, on the other hand, would mean re-implementing resolution —
 * so a helper imported from elsewhere still has to gate visibly at the call
 * site.
 */
function resolveGate(body: string, all: Map<string, string>): boolean {
  if (GATES.some((gate) => body.includes(gate))) return true;

  for (const [name, helperBody] of all) {
    if (!body.includes(`${name}(`)) continue;
    if (GATES.some((gate) => helperBody.includes(gate))) return true;
  }

  return false;
}

const files = walk('app');

console.log('Authorisation completeness — every action and route\n');

// ------------------------------------------------------------ Server Actions

console.log('Server Actions');

const actionFiles = files.filter((f) => f.endsWith('actions.ts'));
check('found the action files', actionFiles.length >= 4, `${actionFiles.length} found`);

for (const file of actionFiles) {
  const source = readFileSync(file, 'utf8');
  const all = functionsIn(source);

  for (const name of exportedNames(source)) {
    if (UNGATED_ACTIONS.has(name)) continue;
    const body = all.get(name);
    if (!body) {
      check(`${file.replace('app/', '')} → ${name}()`, false, 'could not read the function body');
      continue;
    }
    check(
      `${file.replace('app/', '')} → ${name}()`,
      resolveGate(body, all),
      'no auth gate, directly or through a local helper',
    );
  }
}

// -------------------------------------------------------------- Route handlers

console.log('\nRoute handlers');

const routeFiles = files.filter((f) => f.endsWith('route.ts'));

for (const file of routeFiles) {
  const reason = PUBLIC_ROUTES[file];
  const source = readFileSync(file, 'utf8');
  const gated = GATES.some((gate) => source.includes(gate));

  if (reason) {
    // A route on the public list that HAS a gate is not a failure, but the list
    // is now wrong — better to know than to carry a stale exemption.
    check(
      `${file.replace('app/', '')} is public: ${reason}`,
      !gated,
      'it gates now; drop the exemption',
    );
    continue;
  }

  check(`${file.replace('app/', '')} authenticates`, gated, 'no auth gate in the file');
}

// ------------------------------------------------------------- Admin surfaces

console.log('\nAdmin surfaces');

// Every page under /admin must gate for admin specifically, not merely for a
// signed-in user — `requireUser()` on an admin page is the exact mistake this
// catches, and it looks correct at a glance.
const adminPages = files.filter(
  (f) => f.startsWith('app/(app)/admin/') && (f.endsWith('page.tsx') || f.endsWith('layout.tsx')),
);

check('found the admin pages', adminPages.length >= 5, `${adminPages.length} found`);

const adminLayoutGates = adminPages.some(
  (f) => f.endsWith('layout.tsx') && readFileSync(f, 'utf8').includes('requireAdmin('),
);
check('the admin layout itself calls requireAdmin()', adminLayoutGates);

for (const file of adminPages) {
  const source = readFileSync(file, 'utf8');
  const gated = source.includes('requireAdmin(');
  // A page nested under a gated layout is defended, but relying on that means
  // any future re-parenting silently removes the check.
  check(
    `${file.replace('app/(app)/', '')} calls requireAdmin()`,
    gated,
    'relies on the layout alone',
  );
}

console.log(
  failures === 0
    ? `\nAll ${checks} authorisation checks passed.`
    : `\n${failures} of ${checks} authorisation checks FAILED.`,
);

process.exit(failures === 0 ? 0 : 1);
