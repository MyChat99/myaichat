# myaichat — a walkthrough

For a technical reader who wants to know what was built, how it holds together,
and what state it is actually in. No hype, and the unfinished parts are named.

**Live:** `myaichat-production.up.railway.app` · **Repo:** `github.com/MyChat99/myaichat`

---

## What it is

A multi-provider AI chat platform. You bring your own OpenAI and Anthropic keys;
it gives you streaming chat, an admin panel to manage providers and models,
per-user theming, usage analytics and an audit trail.

The interesting constraint is that **it is not tied to a provider**. Adding a
third means writing one adapter file and one registry line — no route change, no
UI change, no schema change. That claim is enforced by a test that greps the
tree and fails if a vendor SDK import or a provider name appears outside
`lib/providers`.

## By the numbers

| | |
| --- | --- |
| TypeScript | 20,097 lines across 139 files, strict mode |
| Database | 12 tables, all with row-level security, 16 committed migrations |
| Verification | 23 suites, ~900 assertions, run by one command |
| History | 70 commits across 8 phases and 30 pull requests |
| Decisions recorded | 19 |
| Issues opened | 28, of which 8 remain — none of them code |

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind · Supabase (Postgres,
Auth, RLS) · Anthropic and OpenAI SDKs · Cloudflare R2 · Resend · Railway ·
GitHub Actions.

---

## Architecture

Full diagrams in [ARCHITECTURE.md](ARCHITECTURE.md). The three parts worth
knowing:

### The provider abstraction

`app/api/chat/route.ts` names no vendor and imports no vendor SDK. It asks the
registry for the conversation's model, gets back a `ChatProvider`, and streams
whatever comes out.

Adapters are **factories that take an API key**, not singletons. That is not
stylistic: keys are decrypted per request, so an adapter holding one at module
load would keep serving a key that had since been rotated in the admin panel.

```
/api/chat  →  registry  →  decrypt key  →  adapter(key)  →  vendor SDK
   ↑ no vendor names        ↑ AES-256-GCM    ↑ one request's lifetime
```

### The four authorisation layers

Each assumes the one before it can be bypassed:

1. **`proxy.ts`** — coarse redirect. Explicitly *not* the boundary; API routes
   are exempted from its redirect entirely, because a `fetch` expecting JSON
   that silently follows a 307 into an HTML login page reports success.
2. **`requireUser()` / `requireAdmin()`** — in every page and action. A test
   reads the source and fails if a new one is added without a gate.
3. **RLS** — on all 12 tables, three of them deny-all and reachable only by the
   service role. A bug that reached the database with the wrong user id still
   cannot read another user's rows.
4. **`SECURITY DEFINER` helpers** — because a policy *on* `profiles` that
   queries `profiles` recurses infinitely. That bug blocked every profile edit
   and **passed its first test**, because a blocked update and a crashed update
   both return zero rows.

High-value actions add a fifth: writing a provider key, deleting a model or
changing a role re-verifies the password server-side, on a throwaway client, and
is throttled so the field is not a password oracle.

### Secrets

Provider keys are AES-256-GCM at rest, format `v1.<iv>.<tag>.<ciphertext>`. The
version prefix exists so an algorithm change can read both formats and
re-encrypt on write rather than needing a flag day. GCM is authenticated, so a
tampered value throws instead of decrypting to garbage.

The master key lives only in the environment. Every module on the decryption
path imports `server-only`, so an accidental client import fails the build
rather than leaking.

---

## The testing story

**There is no test framework.** Every check is a script that exercises the real
database, the real running server, or the real source. That is a deliberate
choice, and the reason is empirical: the bugs this project actually hit were not
the kind a mocked unit test catches.

The rule the suite is built on: **assert stored state, not response shape.**

Three examples of why:

**A blocked write and a crashed write look identical.** The RLS recursion bug
returned zero rows either way. The test that "passed" was reading the response;
the fix was to read the value back with a different client.

**A 200 can be a failure.** An unauthenticated `POST /api/chat` once returned
200 with an HTML login page, because the proxy redirected it and `fetch`
followed. Tests now assert status *and* content type.

**A test can be true and useless.** The chat route sent the model the **oldest**
40 messages instead of the newest — `ORDER BY created_at ASC LIMIT 40`. Nothing
errored; the assistant just seemed to lose the thread on long conversations. A
test asserting "40 rows returned" passes the broken version. The test now
asserts the window *ends with the newest message and excludes the oldest*.

| Suite | Asserts | Needs |
| --- | --- | --- |
| `verify:degradation` | 194 — every dependency fails clearly and leaks nothing | — |
| `verify:theme` | 134 — WCAG AA contrast, every theme, both modes | — |
| `verify:api` | 84 — every route rejects bad input and other users | server |
| `verify:logging` | 67 — one log shape, no secrets, proven by capture | — |
| `verify:resilience` | 50 — retry policy, backoff, outbound timeouts | — |
| `verify:security` | 42 — throttling, password rules, rate limits, budgets | database |
| `verify:session` | 41 — idle policy, refresh-token behaviour | database |
| `verify:authz` | 39 — no action or route shipped without a gate | — |
| `verify:attachments` | 33 — every upload rejection path | — |
| `verify:headers` | 25 — header and CSP configuration, both modes | — |
| `verify:csv` | 36 — CSV escaping and formula injection | — |
| `verify:bundle` | 7 — heavy libraries stay confined | build |
| plus 11 more | schema, rls, seed, storage, gates, appearance, chat, providers, admin, email, smoke | |

`npm run verify:all` runs all 23 in a safe order and proves the database is as
it started — refusing to begin if a previous run left it dirty.

Two are worth singling out:

- **`verify:providers`** greps the tree. Two providers both streaming would pass
  a behavioural test with an `if/else` in the route; this fails it.
- **`verify:admin`** breaks **only the database key** and asserts chat then
  fails — proving there is no silent fallback to an environment variable.

---

## Things that were found by looking, not by testing

The honest part. These are bugs that shipped and were caught later, and what
each one changed.

**The model was sent the oldest messages, not the newest.** Past 40 turns it
never saw the question just asked. No error, no bad status — it reads as a model
limitation. Found by reading the query during an adversarial review.

**A stolen refresh token — and then my own test was the bug.** I wrote a test
that simulated the theft rather than asserting the assumption, and it reported
that a replayed token stayed valid indefinitely. It did not. `supabase-js`
resolves successfully for a token whose successor exists, returning that
successor, where the auth endpoint answers 400 — so "the promise resolved" is
not "the token was accepted". Re-measured against the endpoint directly, a
stolen token is refused as soon as the victim rotates past it. I had reported a
High-severity hole on the strength of a helpful SDK.

The residual finding is smaller and real: reuse is *refused* but not *detected*,
so a theft is stopped and leaves no trace.

**Upload endpoints were rate-limited by counting their own audit rows.** That
coupled a permanent record to a rolling window — pruning one damaged the other.
Downloads had no limit at all, because nothing audited them.

**A "new device" alert would have fired monthly for everyone.** The first
fingerprint kept the browser's major version, which is exactly the digit Chrome
changes every four weeks. Caught by a test asserting a version bump is the same
device.

**CI was red on `main` for forty minutes and I did not notice**, because the
next commit fixed the formatting before I looked. That one is now structurally
impossible — branch protection requires the checks to pass on the exact commit.

**The health endpoint published outage details.** Unauthenticated by necessity,
it echoed the database's own error message — fine for the errors you see while
everything works, and exactly wrong for the ones that appear during an outage,
which carry a host and a role name. The test could not catch it because it only
ever ran against a healthy database.

**A wrapper was tested for a whole session without being called anywhere.**
57 checks reported that request logging worked while four routes logged nothing
at all. Tested dead code is worse than none.

**A timeout helper did not time out.** `.unref()` on the timer meant it did not
hold the event loop — and neither does a pending promise — so the process exited
before the deadline fired. Its own test caught it by ending mid-run.

---

## Phase history

Built in eight phases, each with its own acceptance criteria. `Done` means
built; `Verified` means every criterion proved.

| # | Phase | State | Key commit |
| --- | --- | --- | --- |
| 1 | Foundation — scaffold, auth, schema, RLS | Verified | `063cb7c` |
| 2 | Streaming chat, persistence, message actions | Verified | `118fa3c` |
| 3 | Provider abstraction, second provider, model selector | Verified | `37fa660` |
| 4 | Admin panel, encrypted keys, audit logging | Verified | `46d112e` |
| 5 | Theming — 7 presets, zero-flash SSR | Done | `f52e633` |
| 6 | R2 uploads, attachments, Resend templates | **Blocked** — needs credentials | `09eebd4` |
| 7 | Analytics, audit UI, motion, command palette | Partial | `6c67cc5` |
| 8 | CI/CD, branch protection, health check | Done | `f99674e` |

---

## What is not finished

- **Phase 6 needs credentials.** Every rejection path is built and tested; the
  only untestable step is the PUT to the bucket. [The checklist](wiki/PHASE-6-CHECKLIST.md)
  is written and needs no code change.
- **Refresh-token reuse detection is off** — a Supabase dashboard setting, filed
  as ISSUE-028 with the exact toggle.
- **Phase 7's performance and accessibility passes** need a browser and
  Lighthouse; they are not measurable headlessly and are not claimed.
- **CI and the Railway deploy are not chained.** Every deploy comes from a
  CI-green commit because merges require it, but the deploy is not itself gated.
  Written up with tradeoffs and a recommendation of *not yet*.

Current state, always: [PROGRESS.md](wiki/PROGRESS.md). Known problems:
[ISSUES.md](wiki/ISSUES.md). Why things are the way they are:
[DECISIONS.md](wiki/DECISIONS.md).

---

## If you only read one file

[`lib/providers/README.md`](../lib/providers/README.md) — adding a provider in
five steps, and the vendor differences the abstraction absorbs. That table is
the clearest statement of what this codebase is for:

| | Anthropic | OpenAI |
| --- | --- | --- |
| System prompt | separate field | first message |
| Output cap | `max_tokens` | `max_completion_tokens` |
| Usage while streaming | on the final message | only with `stream_options` |
| Out of credit | 4xx with a billing message | 429 with `insufficient_quota` |
| `max_tokens: 1` | truncates | **errors** |

That last row is why `validateKey()` performs a real generation instead of
listing models: an unfunded key lists models perfectly happily and fails only
when you ask it to write something.
