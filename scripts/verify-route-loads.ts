/**
 * Routes must not go back to loading their data one round trip at a time.
 *
 * This is a guard on a regression that already happened twice. `/` and
 * `/c/[id]` each grew to seven or eight sequential `await`s, several of them
 * written inline in the JSX — which serialises them by construction, because a
 * prop cannot be evaluated until the one before it has resolved. Measured
 * against the hosted database that was **442ms sequential against a 104ms
 * parallel floor**, and on the deployment it was most of a second on every
 * navigation.
 *
 * Deterministic on purpose. A timing budget would have caught the same thing,
 * and would also fail on a slow morning — this reads the source, so it fails
 * only when the code is actually wrong.
 *
 * Two rules:
 *
 *   1. **No `await` inside returned JSX.** There is no case where this is the
 *      right way to load something: it always serialises, and moving the call
 *      above the `return` costs nothing.
 *   2. **More than two independent top-level loads must be grouped.** Auth has
 *      to come first, and one query after it is fine. Beyond that, a chain of
 *      awaits with no `Promise.all` is the shape that caused this.
 *
 *   npm run verify:routes
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(name: string, passed: boolean, detail = '') {
  if (passed) console.log(`  ok    ${name}`);
  else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/^(page|layout)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strips comments so prose about `await` is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Everything after the component's `return (`. Awaits below this line are
 * inside JSX — the shape that serialises silently.
 */
function jsxBody(source: string): string {
  const at = source.indexOf('\n  return (');
  return at === -1 ? '' : source.slice(at);
}

/**
 * Top-level awaits: those at exactly one level of indentation inside the
 * component body, which is where a page's data loading lives. Awaits nested
 * deeper are inside a `Promise.all`, a callback or a branch, and are not what
 * this is about.
 */
function topLevelAwaits(source: string): string[] {
  const body = source.split('\n  return (')[0];
  return body
    .split('\n')
    .filter((line) => /^ {2}(const|let|await)\b.*\bawait\b/.test(line))
    .map((line) => line.trim());
}

function main() {
  console.log('Routes load their data in parallel\n');

  const files = walk('app').sort();
  check('found the route files', files.length > 0, `${files.length}`);

  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const label = file.replace(/^app\//, '');

    /**
     * Rule 1. An `await` in a JSX prop cannot start until every prop before it
     * has resolved, so a page with four of them has four serial round trips no
     * matter how cheap each one is.
     */
    const inJsx = jsxBody(source).match(/\{await\s+\w/g) ?? [];
    check(`${label}: no await inside the returned JSX`, inJsx.length === 0, inJsx.join(', '));

    /**
     * Rule 2. Auth first, then at most one more read, unless the reads are
     * grouped. `createClient()` is not a round trip — it reads cookies — so it
     * is not counted.
     */
    const loads = topLevelAwaits(source).filter((line) => !/createClient\(\)/.test(line));
    const grouped = /Promise\.all\(/.test(source);
    check(
      `${label}: independent loads are grouped`,
      loads.length <= 2 || grouped,
      `${loads.length} sequential loads and no Promise.all`,
    );
  }

  console.log(
    failures === 0
      ? '\nEvery route loads its data in parallel.'
      : `\n${failures} route-load check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
