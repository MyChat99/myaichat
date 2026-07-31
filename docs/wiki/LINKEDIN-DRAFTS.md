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
> admin panel for keys and models, seven themes, usage analytics and an audit
> trail.
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
> **There's no test framework.** 17 suites, ~500 assertions, every one against
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
> There's no test framework — 17 suites, ~500 assertions, all against the real
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

## Notes on all three

**What is deliberately absent:** "cutting-edge", "leveraging", "seamless",
"game-changing", any claim about time taken, and any metric I cannot show. The
figures used — 12 tables, 17 suites, ~500 assertions — are all checkable in the
repo, which is the point of quoting them.

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
