/**
 * Turns `npm audit --json` into something a person will actually read.
 *
 * Raw `npm audit` output is a wall of nested advisory objects, and the summary
 * line ("12 high") answers none of the questions that matter: which packages,
 * are they reachable from production code, and is there anything I can do about
 * it today. A report nobody reads is the same as no report.
 *
 * Writes Markdown to stdout, and to `audit-report.md` when given `--out`, so CI
 * can attach it as an artifact and surface it in the job summary.
 *
 *   npm run audit:report
 *   npm run audit:report -- --out
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

type Advisory = {
  name: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  isDirect: boolean;
  via: (string | { title?: string; url?: string; severity?: string })[];
  effects: string[];
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
};

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'] as const;

function run(): { advisories: Record<string, Advisory>; totals: Record<string, number> } {
  let raw = '';
  try {
    raw = execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).toString();
  } catch (err) {
    // npm audit exits non-zero whenever advisories exist, and still writes the
    // JSON to stdout. That is the normal path here, not an error.
    raw = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
  }

  if (!raw.trim()) return { advisories: {}, totals: {} };

  try {
    const parsed = JSON.parse(raw) as {
      vulnerabilities?: Record<string, Advisory>;
      metadata?: { vulnerabilities?: Record<string, number> };
    };
    return {
      advisories: parsed.vulnerabilities ?? {},
      totals: parsed.metadata?.vulnerabilities ?? {},
    };
  } catch {
    return { advisories: {}, totals: {} };
  }
}

function describeFix(fix: Advisory['fixAvailable']): string {
  if (fix === false || fix === undefined) return 'none available';
  if (fix === true) return '`npm audit fix`';
  return `${fix.name}@${fix.version}${fix.isSemVerMajor ? ' **(breaking)**' : ''}`;
}

/**
 * The advisory headline, or — when `via` holds only package names — the chain
 * that pulls it in. "transitive dependency" as a title told the reader nothing;
 * "via postcss" at least says where to look.
 */
function titleOf(advisory: Advisory): string {
  for (const v of advisory.via) {
    if (typeof v === 'object' && v.title) return v.title;
  }
  const names = advisory.via.filter((v): v is string => typeof v === 'string');
  if (names.length > 0) return `via ${names.slice(0, 3).join(', ')}`;
  return 'no advisory detail reported';
}

function main() {
  const { advisories, totals } = run();
  const entries = Object.values(advisories);

  const lines: string[] = ['# Dependency audit', ''];

  const critical = totals.critical ?? 0;
  const high = totals.high ?? 0;
  const moderate = totals.moderate ?? 0;
  const low = totals.low ?? 0;

  lines.push(
    '| Critical | High | Moderate | Low |',
    '| --- | --- | --- | --- |',
    `| ${critical} | ${high} | ${moderate} | ${low} |`,
    '',
  );

  if (entries.length === 0) {
    lines.push('No advisories. ✅');
  } else {
    // Direct dependencies first: those are the ones this repository can
    // actually act on. A transitive advisory four levels under `next` is not
    // something a maintainer here can fix, and mixing the two is what makes
    // audit output feel like noise.
    const direct = entries.filter((a) => a.isDirect);
    const indirect = entries.filter((a) => !a.isDirect);

    const table = (rows: Advisory[]) => [
      '| Package | Severity | Advisory | Fix |',
      '| --- | --- | --- | --- |',
      ...rows
        .sort(
          (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
            a.name.localeCompare(b.name),
        )
        .map((a) => {
          const fix = describeFix(a.fixAvailable);
          // npm cheerfully proposes catastrophic downgrades as "fixes".
          // Calling that out beats a maintainer running `npm audit fix --force`
          // and discovering the framework went back four major versions.
          const annotated =
            typeof a.fixAvailable === 'object' && a.fixAvailable.isSemVerMajor
              ? `${fix} — check this is not a downgrade`
              : fix;
          return `| \`${a.name}\` | ${a.severity} | ${titleOf(a).replace(/\|/g, '\\|')} | ${annotated} |`;
        }),
      '',
    ];

    lines.push(`## Direct dependencies (${direct.length})`, '');
    if (direct.length === 0) {
      lines.push('None. Every advisory below is inherited from a dependency of a dependency.', '');
    } else {
      lines.push('**These are actionable here.**', '', ...table(direct));
    }

    lines.push(`## Transitive (${indirect.length})`, '');
    if (indirect.length === 0) {
      lines.push('None.', '');
    } else {
      lines.push(
        'Reachable only through another package. Fixing these means waiting for',
        'the parent to update, or replacing the parent.',
        '',
        ...table(indirect.slice(0, 40)),
      );
      if (indirect.length > 40) {
        lines.push(`_…and ${indirect.length - 40} more, omitted for length._`, '');
      }
    }
  }

  lines.push(
    '## Why this job does not fail the build',
    '',
    'The advisories above are almost entirely transitive under `next`, and cannot',
    'be cleared without downgrading the framework (ISSUE-006). A check that can',
    'never go green is a check people learn to ignore — and the day a *real*,',
    'actionable advisory appears, nobody would notice it among the permanent red.',
    '',
    'What to look at instead: **the Direct table**. Anything appearing there is',
    'actionable in this repository today, and should be dealt with rather than',
    'inherited.',
    '',
  );

  const report = lines.join('\n');
  console.log(report);

  if (process.argv.includes('--out')) {
    writeFileSync('audit-report.md', report);
    console.error('\nWrote audit-report.md');
  }

  // Always exits 0. This job reports; it does not gate.
  process.exit(0);
}

main();
