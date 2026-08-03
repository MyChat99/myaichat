/**
 * What the app actually costs to load and to use, measured.
 *
 * Written before any optimisation, so every change afterwards has a number to
 * beat rather than a story about why it should be faster. Run it, change one
 * thing, run it again.
 *
 * Everything here is measured through CDP against the real running app:
 *
 *   FCP / LCP        when something first appears, and when the biggest thing does
 *   long tasks       main-thread blocks over 50ms — the actual cause of "choppy"
 *   TBT              total blocking time, the sum of what those tasks cost
 *   transfer         bytes over the wire per route, script bytes separately
 *   re-renders       React commits during a streamed answer
 *   nav              client-side route change cost
 *
 * At 4× CPU throttling by default, because the complaint is about a phone and
 * an unthrottled laptop measurement answers a question nobody asked.
 *
 *   npm run dev
 *   npm run measure:perf
 *   npm run measure:perf -- --throttle=1     (unthrottled, for comparison)
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { chromium, type CDPSession, type Page } from 'playwright';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const BASE = arg('base', process.env.BASE_URL ?? 'http://localhost:3000');
const THROTTLE = Number(arg('throttle', '4'));
const LABEL = arg('label', 'run');
const OUT = 'docs/perf';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'perf-measure-password-1234';

/** How many conversations the sidebar is asked to draw. Real users accumulate. */
const CONVERSATIONS = Number(arg('conversations', '60'));

/**
 * Samples per route, reported as a median.
 *
 * One sample per route is not a measurement. Server round-trip latency to a
 * hosted database varies by tens of milliseconds run to run, and the first
 * request to a freshly started server pays for compilation that no user ever
 * sees — a single reading swamped a real 300ms improvement with noise, and
 * showed one route getting *slower* when it had not changed at all.
 */
const REPEAT = Number(arg('repeat', '5'));

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

type RouteResult = {
  route: string;
  ttfbMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  domInteractiveMs: number;
  loadMs: number;
  longTasks: number;
  longestTaskMs: number;
  totalBlockingMs: number;
  transferKb: number;
  domNodes: number;
};

/**
 * Paint and blocking timings, collected by an observer installed BEFORE
 * navigation — `PerformanceObserver` with `buffered: true` still misses
 * long tasks that finish before a late subscription.
 */
const OBSERVER = `
  window.__perf = { longTasks: [], lcp: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perf.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perf.lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
`;

const READ = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const tasks = (window.__perf && window.__perf.longTasks) || [];
  return {
    fcp: fcp ? fcp.startTime : null,
    // Time to first byte: how much of "slow" is the server thinking, before
    // the browser has been given anything to do at all.
    ttfb: nav.responseStart || 0,
    lcp: (window.__perf && window.__perf.lcp) || null,
    domInteractive: nav.domInteractive || 0,
    load: nav.loadEventEnd || 0,
    longTasks: tasks.length,
    longest: tasks.length ? Math.max.apply(null, tasks) : 0,
    // Total Blocking Time: everything a long task costs beyond its first 50ms.
    tbt: tasks.reduce(function (sum, d) { return sum + Math.max(0, d - 50); }, 0),
    domNodes: document.getElementsByTagName('*').length,
  };
})()`;

async function measureRoute(
  page: Page,
  client: CDPSession,
  route: string,
  path: string,
): Promise<RouteResult> {
  let transfer = 0;
  let script = 0;
  const onResponse = async (r: import('playwright').Response) => {
    try {
      const headers = await r.allHeaders();
      const size = Number(headers['content-length'] ?? 0);
      transfer += size;
      if (/javascript/.test(headers['content-type'] ?? '')) script += size;
    } catch {
      /* a response that went away mid-flight is not worth failing over */
    }
  };
  page.on('response', onResponse);

  await client.send('Network.clearBrowserCache');
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 60_000 });
  // Long tasks and LCP keep arriving after `load`.
  await page.waitForTimeout(2500);

  const m = (await page.evaluate(READ)) as {
    fcp: number | null;
    ttfb: number;
    lcp: number | null;
    domInteractive: number;
    load: number;
    longTasks: number;
    longest: number;
    tbt: number;
    domNodes: number;
  };
  page.off('response', onResponse);

  return {
    route,
    ttfbMs: Math.round(m.ttfb),
    fcpMs: m.fcp === null ? null : Math.round(m.fcp),
    lcpMs: m.lcp === null ? null : Math.round(m.lcp),
    domInteractiveMs: Math.round(m.domInteractive),
    loadMs: Math.round(m.load),
    longTasks: m.longTasks,
    longestTaskMs: Math.round(m.longest),
    totalBlockingMs: Math.round(m.tbt),
    transferKb: Math.round(transfer / 1024),
    domNodes: m.domNodes,
  };
}

function row(r: RouteResult): string {
  return `| ${r.route} | ${r.ttfbMs} | ${r.fcpMs ?? '—'} | ${r.lcpMs ?? '—'} | ${r.domInteractiveMs} | ${r.longTasks} | ${r.longestTaskMs} | ${r.totalBlockingMs} | ${r.transferKb} | ${r.domNodes} |`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = `perf-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  const lines: string[] = [];
  const say = (s = '') => {
    console.log(s);
    lines.push(s);
  };

  try {
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn!.session)).toString('base64')}`;

    const { data: model } = await admin
      .from('models')
      .select('id, providers!inner(key_last4)')
      .eq('enabled', true)
      .not('providers.key_last4', 'is', null)
      .limit(1)
      .maybeSingle();

    /**
     * A sidebar with real volume in it. One conversation tells you nothing
     * about a list that renders every row it is given.
     */
    const rows = Array.from({ length: CONVERSATIONS }, (_, i) => ({
      user_id: userId,
      title: `Conversation number ${i + 1} — a title of a fairly ordinary length`,
      model_id: model?.id ?? null,
    }));
    const { data: convos } = await admin.from('conversations').insert(rows).select('id');
    const first = convos![0].id;

    // One conversation with a real thread in it, for the thread-render cost.
    await admin.from('messages').insert(
      Array.from({ length: 30 }, (_, i) => ({
        conversation_id: first,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content:
          i % 2 === 0
            ? `Question ${i}: what is a monotype and how does it differ from a lithograph?`
            : `Answer ${i}. A monotype is a single impression pulled from a smooth plate.\n\n\`\`\`js\nconst impressions = 1;\n\`\`\`\n\nIt cannot be editioned.`,
        input_tokens: 40,
        output_tokens: 120,
      })),
    );

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    });
    await context.addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: new URL(BASE).hostname,
        path: '/',
      },
    ]);
    const page = await context.newPage();
    await page.addInitScript(OBSERVER);

    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    if (THROTTLE > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

    say(`# Performance — ${LABEL}`);
    say();
    say(
      `CPU throttle **${THROTTLE}×**, ${CONVERSATIONS} conversations in the sidebar, 30 messages in the open thread, 1440×900, cache cleared per route. **Median of ${REPEAT}**, after a discarded warm-up.`,
    );
    say();
    say(
      '| route | TTFB | FCP | LCP | DOM interactive | long tasks | longest | TBT | transfer KB | DOM nodes |',
    );
    say('|---|---|---|---|---|---|---|---|---|---|');

    const results: RouteResult[] = [];
    for (const [route, path] of [
      ['chat (empty)', '/'],
      ['chat (30 msgs)', `/c/${first}`],
      ['compare', '/compare'],
      ['settings', '/settings'],
      ['admin', '/admin'],
    ] as const) {
      // One warm-up that is thrown away: the first hit of a route on a freshly
      // started server pays for compilation nobody else ever pays for.
      await measureRoute(page, client, route, path);

      const samples: RouteResult[] = [];
      for (let i = 0; i < REPEAT; i++) samples.push(await measureRoute(page, client, route, path));

      const r: RouteResult = {
        route,
        ttfbMs: median(samples.map((s) => s.ttfbMs)),
        fcpMs: median(samples.map((s) => s.fcpMs ?? 0)),
        lcpMs: median(samples.map((s) => s.lcpMs ?? 0)),
        domInteractiveMs: median(samples.map((s) => s.domInteractiveMs)),
        loadMs: median(samples.map((s) => s.loadMs)),
        longTasks: median(samples.map((s) => s.longTasks)),
        longestTaskMs: median(samples.map((s) => s.longestTaskMs)),
        totalBlockingMs: median(samples.map((s) => s.totalBlockingMs)),
        transferKb: median(samples.map((s) => s.transferKb)),
        domNodes: median(samples.map((s) => s.domNodes)),
      };
      results.push(r);
      say(row(r));
    }

    say();

    /**
     * Client-side navigation, which is what "choppy" usually means: the app is
     * already loaded and moving between sections still stutters.
     */
    say('## Client-side navigation (already loaded)');
    say();
    say('| from → to | ms |');
    say('|---|---|');

    await page.goto(`${BASE}/c/${first}`, { waitUntil: 'networkidle' });
    // Whichever nav this page renders — the press tab strip on chat pages, the
    // shell nav elsewhere. Both carry the same hrefs, and only one is visible.
    const clickNav = async (href: string) => {
      const links = page.locator(`a[href="${href}"]`);
      const total = await links.count();
      for (let i = 0; i < total; i++) {
        if (await links.nth(i).isVisible()) return links.nth(i).click({ timeout: 20_000 });
      }
      throw new Error(`no visible link to ${href}`);
    };

    for (const [label, href, settle] of [
      // Scoped to the press tab strip: the shell nav renders the same hrefs and
      // is hidden on chat pages, so a bare href matches two elements and picks
      // the invisible one.
      ['chat → presses', '/compare', '[data-press="compare-setup"]'],
      ['presses → appearance', '/settings', 'main'],
      ['appearance → chat', '/', '[data-press="coupon"]'],
    ] as const) {
      const samples: number[] = [];
      for (let i = 0; i < REPEAT; i++) {
        // Back to the start each time, so every sample measures the same hop.
        await page.goto(`${BASE}/c/${first}`, { waitUntil: 'networkidle' });
        if (href !== '/compare') {
          await clickNav('/compare');
          await page.waitForSelector('[data-press="compare-setup"]', { timeout: 30_000 });
        }
        if (href === '/') {
          await clickNav('/settings');
          await page.waitForSelector('main', { timeout: 30_000 });
        }
        const started = Date.now();
        await clickNav(href);
        await page.waitForSelector(settle, { timeout: 30_000 });
        samples.push(Date.now() - started);
      }
      say(`| ${label} | ${median(samples)} |`);
    }

    say();

    /**
     * The streamed-answer cost. Counted as React commits, because the suspicion
     * is that every token re-renders the whole thread rather than one node.
     */
    say('## While an answer streams');
    say();

    await page.goto(`${BASE}/c/${first}`, { waitUntil: 'networkidle' });
    await page.evaluate(`
      window.__commits = 0;
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && hook.onCommitFiberRoot) {
        const original = hook.onCommitFiberRoot;
        hook.onCommitFiberRoot = function (...args) {
          window.__commits++;
          return original.apply(this, args);
        };
      } else if (hook) {
        hook.onCommitFiberRoot = function () { window.__commits++; };
      }
      window.__perf.longTasks = [];
    `);

    await page.fill('textarea', 'Write four short sentences about printing presses.');
    const streamStarted = Date.now();
    await page.click('[data-press="quill"]');

    // Wait for the caret to go away, i.e. the stream finished.
    for (let i = 0; i < 120; i++) {
      const streaming = await page.evaluate(
        `document.querySelector('[data-press="caret"]') !== null`,
      );
      if (i > 2 && !streaming) break;
      await page.waitForTimeout(500);
    }

    const stream = (await page.evaluate(`(() => ({
      commits: window.__commits,
      longTasks: window.__perf.longTasks.length,
      longest: window.__perf.longTasks.length ? Math.max.apply(null, window.__perf.longTasks) : 0,
      blocking: window.__perf.longTasks.reduce(function (s, d) { return s + Math.max(0, d - 50); }, 0),
    }))()`)) as { commits: number; longTasks: number; longest: number; blocking: number };

    say(`- wall clock: **${Math.round((Date.now() - streamStarted) / 100) / 10}s**`);
    // Reported honestly: React's devtools hook is not present in a production
    // build, so this counts nothing there. It is a dev-build number or none.
    say(
      `- React commits: **${stream.commits === 0 ? 'not measurable in a production build' : stream.commits}**`,
    );
    say(
      `- long tasks during the stream: **${stream.longTasks}**, longest **${Math.round(stream.longest)}ms**, blocking **${Math.round(stream.blocking)}ms**`,
    );
    say();

    const worst = results.reduce((a, b) => (a.totalBlockingMs > b.totalBlockingMs ? a : b));
    say(
      `**Worst route by blocking time:** ${worst.route} — ${worst.totalBlockingMs}ms across ${worst.longTasks} long tasks, ${worst.domNodes} DOM nodes.`,
    );

    await browser.close();
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  const file = `${OUT}/${LABEL}.md`;
  writeFileSync(file, `${lines.join('\n')}\n`);
  appendFileSync(file, `\nMeasured ${new Date().toISOString()} against ${BASE}.\n`);
  console.log(`\nWritten to ${file}`);
}

main().catch((err: unknown) => {
  console.error('measure-performance crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
