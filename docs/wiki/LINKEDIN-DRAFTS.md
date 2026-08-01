# LinkedIn drafts

Three lengths. All first person, all plain language, no hype. Pick one, fill the
two placeholders, post.

**Placeholders in every draft:**

- `[LIVE URL]` → `https://myaichat-production.up.railway.app`
- `[REPO URL]` → `https://github.com/MyChat99/myaichat`

**Before posting:** run `npm run seed -- --demo`, take the four screenshots
listed in `docs/screenshots/README.md`, and attach them. A post about a UI with
no picture of the UI performs badly, and the charts look like three flat lines
without the demo data.

---

## Short — ~90 words

Best for: you want the click, not the read. Pair with the chat screenshot.

> I built a multi-provider AI chat platform. You bring your own OpenAI and
> Anthropic keys and get streaming chat, an admin panel, per-user theming and
> usage analytics.
>
> It does not look like every other chat app. The default theme is a risograph
> print: newsprint paper, Federal Blue ink, hard black keylines.
>
> The part I'm most pleased with isn't a feature. Adding a third AI provider
> takes one adapter file and one line in a registry — no route changes, no UI
> changes. There's a test that greps the codebase and fails the build if a
> vendor SDK import escapes that folder, because two providers working is not
> the same as an abstraction working.
>
> Next.js 16, Supabase, TypeScript strict.
>
> Live: [LIVE URL]
> Code: [REPO URL]

---

## Medium — ~250 words

Best for: the default. Enough substance to be worth reading, short enough to be
read. Pair with two or three screenshots.

> I spent the last stretch building **myaichat** — a multi-provider AI chat
> platform. Bring your own OpenAI and Anthropic keys; get streaming chat, an
> admin panel for keys and models, eight themes, usage analytics and an audit
> trail. The default look is a risograph print — paper stock rather than a white
> page, and two real Riso inks.
>
> Three things I'd point at:
>
> **The provider abstraction is enforced, not just intended.** Adding a third
> provider is one adapter file plus one registry line. A test greps the tree and
> fails if a vendor SDK import or a provider name appears outside that folder —
> because two providers both working would pass a behavioural test with an
> if/else in the route.
>
> **Provider keys are encrypted at rest** with AES-256-GCM and never reach the
> client. Every module on the decryption path imports `server-only`, so an
> accidental client import fails the build rather than leaking. Writing or
> rotating a key asks for the password again — a stolen session alone shouldn't
> be able to swap the key that bills your account.
>
> **There's no test framework.** 23 suites, ~900 assertions, every one against
> the real database, the real server or the real source. That's deliberate: the
> bugs this project actually hit weren't the kind a mocked unit test catches.
> One example — an RLS policy that queried its own table recursed infinitely and
> blocked every profile edit, and my first test *passed*, because a blocked
> write and a crashed write both return zero rows. Everything now asserts stored
> state rather than response shape.
>
> Next.js 16 · Supabase · TypeScript strict · Railway
>
> Live: [LIVE URL] · Code: [REPO URL]

---

## Long — ~500 words

Best for: an audience of engineers, or if you want the post to stand alone
without anyone clicking through. Lead with the chat screenshot.

> **I built a production-grade AI chat platform, and the interesting parts were
> the bugs.**
>
> **myaichat** is multi-provider: bring your own OpenAI and Anthropic keys, get
> streaming chat, an admin panel for keys and models, per-user theming, usage
> analytics and an audit trail. Next.js 16, Supabase with row-level security on
> all 12 tables, TypeScript strict throughout, deployed on Railway.
>
> **It also has a visual identity**, which most side projects skip. The default
> theme is a risograph print — newsprint stock with a green undertone, Federal
> Blue and Fluorescent Pink as the two inks, and hard black keylines where a
> normal app would put a soft grey border. Three of those ink colours had to be
> darkened to clear WCAG AA, and I found out which three because the contrast
> checker is computed from the token data rather than eyeballed: adding a theme
> gets it checked without anyone writing a new test. The fluorescent pink still
> cannot reach 4.5:1 on paper — being brighter than the stock is what
> fluorescent means — so it moved to dark mode, where it genuinely glows.
>
> The architecture claim I care about: **adding a third provider is one adapter
> file and one registry line.** No route change, no UI change, no schema change.
> That's enforced by a test that greps the codebase and fails if a vendor SDK
> import or a provider name appears outside `lib/providers` — because two
> providers both streaming would pass a behavioural test with an `if/else` in
> the route. Working and abstracted aren't the same property.
>
> **On security**, four layers that each assume the one before it can be
> bypassed: a proxy redirect, explicit `requireAdmin()` gates in every page and
> action, RLS in Postgres, and `SECURITY DEFINER` helpers. Provider keys are
> AES-256-GCM at rest. Rotating a key, deleting a model or promoting a user
> re-asks for the password — a stolen session shouldn't be enough for any of
> those.
>
> **But the honest part is what I got wrong.**
>
> An RLS policy on `profiles` that queried `profiles` recursed infinitely and
> blocked every profile edit. My first test passed — because a blocked write and
> a crashed write both return zero rows. Everything in the suite now asserts
> stored state rather than response shape.
>
> The chat route sent the model the **oldest** 40 messages instead of the newest
> — `ORDER BY created_at ASC LIMIT 40`. Nothing errored. The assistant just
> seemed to get worse on long conversations, which reads as a model limitation
> rather than my bug. Found by reading the query, not by any test.
>
> I assumed refresh-token rotation was in force because Supabase rotates by
> default. So I wrote a test that simulated a stolen token instead of asserting
> the assumption: the old token was still accepted twenty seconds after
> rotation, and the legitimate session was untouched. That's a configuration
> gap, and I'd never have found it by testing what I believed.
>
> And an unauthenticated `POST` to the chat endpoint once returned **200 with an
> HTML login page**, because the proxy redirected it and `fetch` followed the
> redirect. Tests now assert status *and* content type.
>
> There's no test framework — 23 suites, ~900 assertions, all against the real
> database, the real running server, or the real source. Given what actually
> broke, mocks would have caught approximately none of it.
>
> It isn't finished, and the repo says so: file storage is waiting on
> credentials, and the accessibility audit needs a browser I can't automate.
> Progress, open issues and the reasoning behind every non-obvious decision are
> all committed alongside the code.
>
> Live: [LIVE URL] · Code: [REPO URL]

---

## Optional addition — the measurement angle

Works as a comment reply, or spliced into the long draft. It is the most
distinctive material and the least common thing to post.

> One habit that paid off more than I expected: measuring before optimising,
> and being willing to conclude there was nothing to do.
>
> I set out to lazy-load the admin charts, expecting an easy win. Measured the
> real build first: 746KB on the login page, and no trace of the charting
> library, the animation library, the markdown renderer or the icon set. The
> framework had already split all of it. There was nothing to move.
>
> The one genuine candidate — 450KB of markdown and syntax highlighting on the
> chat route, which the empty state doesn't need — I deliberately left alone,
> because deferring it risks a visible flash on a conversation that already has
> messages.
>
> So I shipped a test that locks in the state that measured well instead. The
> important assertion isn't the size ceiling, it's that the charting library
> stays confined to one component: route-level splitting only holds while that's
> true, and the day someone imports a chart into a shared component every page
> pays 384KB with nothing failing.
>
> Elsewhere the same habit did find something: a database index chosen by
> benchmarking a 200,000-row temp table, because the real table has 178 rows and
> Postgres correctly sequential-scans it either way. 106ms → 23ms.

---

## Notes on all three

**What is deliberately absent:** "cutting-edge", "leveraging", "seamless",
"game-changing", any claim about time taken, and any metric I cannot show. The
figures used — 12 tables, 23 suites, ~900 assertions — are all checkable in the
repo, which is the point of quoting them.

**Figures as of away session 4B**, and they drift. Re-check before posting:

```bash
node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>k.startsWith('verify:')).length + ' suites')"
git rev-list --count HEAD    # commits
```

**Why the bugs are in the post.** Anyone can list features. Describing a bug
precisely, including the part where the first test passed, is the thing that
demonstrates the skill — and it is also the section engineers actually read to
the end.

**If a comment asks "why not use X?"** — the answer for almost every such
question is committed in `docs/wiki/DECISIONS.md` with the tradeoff stated.
Linking one directly is a stronger reply than writing a new paragraph.

**Do not claim Phase 6 works.** File uploads are built and tested up to the
storage call and are blocked on credentials. The screenshots must not imply
otherwise.
