/**
 * Bundle budget.
 *
 * ## Why this file exists rather than a lazy-loading change
 *
 * The task was to lazy-load anything heavy that is not needed at first paint,
 * with admin charts as the likely win. Measured, the premise did not hold:
 *
 *     /login      746KB   no recharts, no framer-motion, no markdown, no lucide
 *     /profile    752KB
 *     /settings   761KB
 *     /           1211KB  react-markdown + syntax highlighting
 *
 * Recharts is already route-scoped by Next, and lucide is already tree-shaken —
 * both verified by grepping the actual chunks the login page loads. There was
 * nothing to move.
 *
 * The one genuine candidate is the ~450KB of markdown and highlighting on the
 * chat route, which the EMPTY state does not need. It was deliberately NOT
 * lazy-loaded: a conversation page with existing messages needs it immediately,
 * so deferring it risks a visible flash on exactly the page that matters most —
 * a visual change, on a screen no automated check here can inspect.
 *
 * So this locks in the state that measured well, instead. "It is fine today" is
 * worth very little; "it stays fine" is worth something.
 *
 *   npm run verify:bundle
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';

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
 * Heavy libraries, and the ONE client component each is allowed to reach.
 *
 * Route-level code splitting is what keeps them off other pages, and it holds
 * only while each stays confined to a component used by a single route. The day
 * someone imports recharts into a shared component, every page pays 384KB — and
 * nothing would fail, which is why this check exists.
 */
const CONFINED: { lib: string; allowedIn: string[]; why: string }[] = [
  {
    lib: 'recharts',
    allowedIn: ['app/(app)/admin/analytics/analytics-client.tsx'],
    why: '384KB — the single largest dependency in the tree',
  },
  {
    lib: 'react-markdown',
    allowedIn: ['components/chat/markdown.tsx'],
    why: 'pulls the syntax highlighter with it',
  },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

function verifyConfinement() {
  section('Heavy libraries stay in one component');

  const files = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')];

  for (const { lib, allowedIn, why } of CONFINED) {
    const importers = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return new RegExp(`from '${lib}'|from "${lib}"`).test(src);
    });

    check(
      `${lib} is imported by exactly one component (${why})`,
      importers.length === 1,
      importers.join(', '),
    );

    for (const importer of importers) {
      check(
        `  and it is ${allowedIn[0]}`,
        allowedIn.includes(importer),
        `${importer} — route-level splitting only holds while this is true`,
      );
    }
  }
}

function verifyBudget() {
  section('Total client JS');

  const dir = '.next/static/chunks';
  let total = 0;
  let largest = { file: '', kb: 0 };

  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = `${d}/${entry}`;
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (entry.endsWith('.js')) {
        total += stat.size;
        const kb = Math.round(stat.size / 1024);
        if (kb > largest.kb) largest = { file: entry, kb };
      }
    }
  };

  try {
    walk(dir);
  } catch {
    console.log('  skip  no build output — run `npm run build` first');
    return;
  }

  const totalKb = Math.round(total / 1024);
  console.log(`  ..    ${totalKb}KB across all chunks, largest ${largest.kb}KB`);

  // A ceiling with headroom, not a target. It exists to catch a step change —
  // someone adding a charting library to the shared layout — not to police
  // ordinary growth.
  check('total client JS is under 3MB', totalKb < 3072, `${totalKb}KB`);
  check('no single chunk exceeds 600KB', largest.kb < 600, `${largest.file} is ${largest.kb}KB`);
}

function verifyNoBarrelImports() {
  section('Icon imports are named, not namespace');

  // `import * as Icons from 'lucide-react'` defeats tree-shaking and pulls
  // roughly 1,500 icons. Named imports are what keeps it out of every bundle.
  const files = [...sourceFiles('app'), ...sourceFiles('components')];
  const offenders = files.filter((f) =>
    /import \* as \w+ from ['"]lucide-react['"]/.test(readFileSync(f, 'utf8')),
  );
  check('no namespace import of lucide-react', offenders.length === 0, offenders.join(', '));
}

function main() {
  console.log('Bundle budget');

  verifyConfinement();
  verifyBudget();
  verifyNoBarrelImports();

  console.log(
    failures === 0
      ? `\nAll ${checks} bundle checks passed.`
      : `\n${failures} of ${checks} bundle checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
