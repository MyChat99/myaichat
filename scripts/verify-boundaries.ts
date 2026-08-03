/**
 * Nothing on the server may call a function that lives on the client.
 *
 * This exists because of a production 500 that every other check missed. In a
 * production build, each export of a `'use client'` module becomes a client
 * *reference*, not the function itself — so calling one during a server render
 * throws:
 *
 *   Attempted to call attachmentUrl() from the server but attachmentUrl is on
 *   the client.
 *
 * Four things conspired to hide it:
 *
 *   - `tsc` is happy: the types are real, only the runtime value is a proxy.
 *   - `next build` is happy: it is a render-time failure, not a compile error.
 *   - `next dev` is happy: dev keeps the real function, so it simply works.
 *   - the whole verification suite runs against `next dev`.
 *
 * On top of that, the one call site was guarded by `avatarKey ?`, so it only
 * fired for accounts that had actually uploaded a portrait — and every test
 * account this repo creates has none.
 *
 * A static check is the right shape here precisely because the runtime one is
 * so easily missed: it holds whether or not a fixture happens to have an
 * avatar, and it runs in milliseconds with no server at all.
 *
 * Components are exempt. Rendering a Client Component from a Server Component
 * is the normal, supported thing; the rule is about calling client FUNCTIONS.
 * Capitalisation is the convention React itself uses to tell them apart.
 *
 *   npm run verify:boundaries
 */
import { existsSync, readFileSync } from 'node:fs';
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
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function directive(source: string): 'client' | 'server' | null {
  const head = source.trimStart().slice(0, 40);
  if (head.startsWith("'use client'") || head.startsWith('"use client"')) return 'client';
  if (head.startsWith("'use server'") || head.startsWith('"use server"')) return 'server';
  return null;
}

/** Resolves an `@/…` specifier to a file, or null if it is external. */
function resolve(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = spec.slice(2);
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

function main() {
  console.log('Server code never calls a client function\n');

  const files = [...walk('app'), ...walk('components'), ...walk('lib')].sort();
  const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

  const clientModules = new Set(files.filter((f) => directive(sources.get(f)!) === 'client'));

  check('found the source tree', files.length > 0, `${files.length} files`);
  check(
    'and it has client modules to get wrong',
    clientModules.size > 0,
    `${clientModules.size} client modules`,
  );

  const violations: string[] = [];

  for (const file of files) {
    const source = sources.get(file)!;
    // A client module may import whatever it likes from another client module.
    if (directive(source) === 'client') continue;

    for (const m of source.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      // `import type` is erased before it runs and cannot be called.
      if (/import\s+type/.test(m[0])) continue;

      const target = resolve(m[2]);
      if (!target || !clientModules.has(target)) continue;

      for (const raw of m[1].split(',')) {
        const name = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (!name) continue;
        // Capitalised = a component, which is legal to render from the server.
        if (name[0] === name[0].toUpperCase()) continue;
        violations.push(`${file} imports \`${name}\` from client module ${m[2]}`);
      }
    }
  }

  check(
    'no server or shared module imports a callable from a client module',
    violations.length === 0,
    violations.join(' · '),
  );

  /**
   * The specific regression, named. A general rule can be satisfied by moving
   * the problem somewhere the rule does not look; this pins the actual fix.
   */
  check(
    'attachmentUrl lives in a module with no directive, so both sides can call it',
    existsSync('lib/upload/urls.ts') &&
      directive(readFileSync('lib/upload/urls.ts', 'utf8')) === null &&
      /export function attachmentUrl/.test(readFileSync('lib/upload/urls.ts', 'utf8')),
  );

  console.log(
    failures === 0
      ? '\nNo server/client boundary violations.'
      : `\n${failures} boundary check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
