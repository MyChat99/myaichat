# Issues

Known bugs, blockers, and technical debt. **Newest entries at the top.**

**Status:** `Open` · `Resolved`
**Severity:** `Critical` (blocks work / security hole) · `High` · `Medium` · `Low`

## Entry format

```
### ISSUE-NNN — Short title
**Status:** Open | **Severity:** High | **Phase:** 3 | **Opened:** YYYY-MM-DD | **Resolved:** —
**Problem:** What breaks, and how to reproduce.
**Resolution:** What fixed it, or current thinking if still open.
```

---

### ISSUE-028 — A stolen refresh token stays valid, and reuse is not detected

**Status:** Open — needs a dashboard change only you can make | **Severity:** **High** | **Phase:** 1 | **Opened:** 2026-07-31
**Found by:** measuring, rather than assuming, during away session 3.

**Problem:** refresh-token rotation was assumed to be in force because Supabase
rotates by default. It does rotate — every refresh issues a new token. What it
does **not** do on this project is invalidate the old one.

Measured directly by simulating a theft:

```
rotation issues a NEW refresh token   : yes
replay original token, 20s later      : ACCEPTED
legitimate token after the replay     : STILL VALID — family not revoked
```

**What that means concretely.** A refresh token copied out of a browser — an XSS
foothold, a shared machine, a synced cookie jar, a stolen backup — keeps working
alongside the real one. The legitimate user notices nothing, because their own
session is never disturbed. The attacker's access ends only when the token
expires on its own, and it is refreshed on every use, so in practice it does not
expire at all.

Signing out **does** invalidate the token, which is verified and passing. So the
exposure is bounded by the user signing out — which most people never do.

**This is a Supabase project setting, not application code.** Nothing in this
repository can fix it, which is why it is filed rather than patched.

#### The fix, when you are back

Supabase dashboard → **Authentication** → **Sessions**:

| Setting | Set to | Why |
| --- | --- | --- |
| Detect and revoke potentially compromised refresh tokens | **On** | The actual fix. A replayed token revokes the whole family, so a theft ends the session instead of silently sharing it |
| Refresh token reuse interval | 10s (default) | Keeps concurrent requests and flaky networks from destroying sessions. Do not set it to 0 — you will get spurious logouts on mobile |

Consider also setting a **time-boxed session length** on the same page, so even
an undetected theft has an end date.

#### Verify it took

```bash
npm run verify:session
```

It replays a token 20 seconds after rotation and reports what happens. Once the
setting is on, pin it so it cannot regress silently:

```bash
npm run verify:session -- --strict     # turns the warning into a failure
```

**Why it warns rather than fails today:** the check reports a configuration
state that no change in this repository can turn green, and a permanently red
suite is one people stop reading. `--strict` exists so that stops being true the
moment the setting is fixed.

**Partial mitigation shipped in the same change:** an idle-session timeout
(`system_settings.session_idle_timeout_minutes`, default 0/off). It is honest
about its limits — it clears *our* cookie, and does not revoke the Supabase
refresh token. It shortens the window on an unlocked laptop; it does nothing
against someone who has already copied the cookie jar.

### ISSUE-027 — Gate the Railway deploy on CI (prepared, NOT applied)

**Status:** Open — decision waiting on you | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-07-31

**Read the honest version first.** Since branch protection landed, `main` cannot receive a commit that has not passed CI. Railway deploys from `main`, so **every deploy is already from a CI-green commit.** This issue closes a narrow remaining gap, not a hole. Do not do it because it sounds more correct.

#### What the gap actually is

| | Today (Railway watches GitHub) | Gated (CI runs the deploy) |
| --- | --- | --- |
| Deploy source | any commit reaching `main` | only after `quality` + `tests` pass in that run |
| Is CI causally upstream of the deploy? | **No** — they are parallel. CI passing and the deploy happening are two independent reactions to the same push | **Yes** |
| If CI is queued/slow | Railway deploys anyway, possibly before CI finishes | deploy waits |
| If someone deletes branch protection and pushes | deploys immediately | still gated by the job |

So the real-world exposure is: **a window of a minute or two where production is live on a commit whose CI has not finished**, plus the case where protection is deliberately removed. With one maintainer, both are small.

#### The steps, when you decide to do it

**1. Get a Railway token.** Railway → Account Settings → Tokens → *Create token*. Scope it to this project, not the account, if the option is offered.

**2. Add it to GitHub.**
```bash
gh secret set RAILWAY_TOKEN --repo MyChat99/myaichat
# paste the token when prompted — it is not echoed, and not stored in shell history
```

**3. Turn OFF Railway's own trigger.** Railway → your service → Settings → **Deploys** → disable *Auto Deploy* (or disconnect the GitHub trigger). ⚠️ **Do this before step 4.** If both are active you get two deployments racing per merge, and the loser can overwrite the winner.

**4. Enable the job.** In `.github/workflows/ci.yml`, delete the `if: false` line from the `deploy` job. It already declares `needs: [quality, tests]`, so it cannot start until both gates pass.

**5. Add a deploy permission.** The workflow currently sets `permissions: contents: read` at the top. The deploy job needs no more than that for the Railway CLI, but confirm the run does not fail on a permissions error before you trust it.

**6. Prove it.** Merge a trivial change and watch: `quality` and `tests` must both go green *before* `Deploy to Railway` starts. Then confirm the change is live:
```bash
npm run smoke -- --url https://myaichat-production.up.railway.app
```

#### Tradeoffs, stated plainly

**What you gain:** a deploy that is causally downstream of the gates. Rollback stays in the Railway UI either way.

**What you give up:**
- **A long-lived deploy token in GitHub secrets.** Today there is no Railway credential in GitHub at all. This adds one, and it can deploy to production. It becomes something to rotate, and something an action with a supply-chain problem could reach.
- **Railway's own build path.** `railway up` uploads a build context from the runner rather than Railway building from git. That is a *different* build pipeline than the one currently proven in production — a new source of "green in CI, broken in prod".
- **A dependency on GitHub Actions availability** for deploying at all. Today, if Actions is down you can still ship.
- **Slower deploys** — the deploy waits for the full CI run rather than starting immediately.

#### Recommendation

**Not yet.** Branch protection already removed the failure this would prevent almost entirely, and the cost is a production-capable token plus a second build path. Revisit when either becomes true: a second person can merge, or a deploy ever goes out on a commit whose CI later failed. Until then this is complexity bought with a credential.

### ISSUE-026 — CI was red on `main` for one commit and I reported it as pushed

**Status:** Resolved | **Severity:** Medium | **Phase:** 8 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31

**Problem:** Commit `e8d555a` (the Phase 6 attachment UI) landed on `main` with `scripts/verify-attachments.ts` unformatted, and CI failed on `format:check`. I reported that commit as pushed and green. It was pushed; it was not green.

It went unnoticed because the *next* commit ran `npm run format`, so by the time I checked CI at the end of the session the failure had been papered over by a later success. Main was red for roughly forty minutes.

**How it surfaced:** Dependabot cut PR #3 from the red commit, so that PR failed `format:check` — which read as "the react bump breaks the build" and was nothing of the sort. Diagnosing it is what exposed the original failure.

**Resolution:** structural, and already in place. Branch protection (DEC-016) makes this class of error impossible from now on: nothing reaches `main` without a green run **on that exact commit**, because the merge is blocked until the required checks report success on the PR head. The behavioural half — never report a push as green without looking at the run for that SHA — is recorded here rather than trusted to memory.

**Not fixed by:** running the suite locally before committing. I did that; `npm run format` had not been run in that particular sequence, and local `lint` does not check formatting. Only `format:check` does, and only CI ran it.

### ISSUE-025 — A verification suite invented a system setting and broke another suite

**Status:** Resolved | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31
**Problem:** `verify:seed` failed with an unexpected `daily_token_budget_per_user` in `system_settings`.

Two mistakes compounding:

1. The daily token budget was added in session 2 but **never added to the seed's `DEFAULT_SETTINGS`**, so a setting the chat route reads on every request did not exist on a fresh install.
2. `verify:security` restores that setting in `finally` by upserting the value it read — and when the row did not exist, it read `undefined`, defaulted to `0`, and **created** it. The suite left behind a row it had invented, which then failed a different suite from a distance.

**How it went unnoticed:** the end-of-session-2 verification run did not include `verify:seed`. Running a subset and reporting "all suites pass" is how a regression survives a green run — the failure was already present before this session started, and this session found it only because the full suite was run.

**Resolution:** the setting is seeded explicitly (`0` = unlimited, the documented default), the expected set in `verify:seed` follows, and `verify:security` now records whether the row existed and **deletes** it on cleanup if it did not. A test that cannot restore the exact prior state should not run against shared data.
### ISSUE-024 — Truncation deletes by timestamp, so a collision over-deletes

**Status:** Resolved | **Severity:** Low | **Phase:** 2 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31

**Resolution:** migration `20260731140001` adds `messages.seq`, a monotonic
per-row sequence, and truncation now deletes by `seq >= pivot.seq`.

Two details in the migration matter more than the column itself:

- The backfill orders by `(created_at, id)` rather than letting `bigserial`
  number rows in physical order. A `bigserial` added to an existing table
  numbers rows however they sit on disk, which after any update is **not**
  insertion order — that would have silently reordered existing threads.
- The `id` tiebreak makes the backfill deterministic precisely where timestamps
  already collide, which is the condition this issue is about.

The history window, title derivation, thread rendering and export were switched
to `seq` in the same change. `created_at` remains the display timestamp; it is
no longer used to establish order.

**Guarded by** `verify:api`, which writes four messages sharing one timestamp,
truncates from the third, and asserts exactly the first two survive. Under the
old predicate that test leaves nothing — the assertion message says so, so a
future regression reads as the specific bug rather than a mystery.

**Original report below.**

**Status (original):** Open (logged, not fixed) | **Severity:** Low | **Phase:** 2 | **Opened:** 2026-07-31
**Problem:** Regenerate and edit-and-resubmit drop the pivot message and everything after it:

```ts
.delete().eq('conversation_id', id).gte('created_at', pivot.created_at)
```

`created_at` defaults to `now()`, which in Postgres is **transaction time** — several rows inserted in one statement share an identical value. If a user message and its assistant reply ever land on the same timestamp, regenerating from the assistant reply deletes the user's question too.

**Why it is not fixed here:** it has never been observed, and the correct fix is a monotonic sequence column on `messages` — a migration plus a change to every read path that assumes `created_at` ordering. That is structural, and the standing instruction is to log structural work rather than refactor. Two viable fixes when it is picked up:

1. Add `messages.seq bigserial`, order and truncate on that. Correct, and a migration.
2. Delete by `created_at > pivot` **plus** `id != pivot.id` for the equal case. Cheaper, still wrong if three rows collide.

**Mitigating:** the demo-seed script writes explicit spaced timestamps precisely so it cannot manufacture this, and `verify:api` does the same.

### ISSUE-023 — The model was sent the OLDEST 40 messages, not the newest

**Status:** Resolved | **Severity:** High | **Phase:** 2 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31
**Found by:** adversarial self-review, not by a test or a user report.

**Problem:** `/api/chat` built its history like this:

```ts
.order('created_at', { ascending: true }).limit(MAX_HISTORY_MESSAGES)
```

`ORDER BY created_at ASC LIMIT 40` returns the **oldest** forty rows. So once a conversation passed forty messages, the model received the beginning of the thread and **never saw the question that had just been asked** — including the message inserted moments earlier in the same request.

**Why it survived this long:** nothing errors. No exception, no failed insert, no bad status code. The assistant answers fluently, about something from forty messages ago. The only symptom is a model that seems to lose the thread on long conversations — which reads as a model limitation rather than a bug in our code, and would have been reported that way. The longest conversation in this database is 31 messages, so it had not triggered in practice yet.

**Resolution:** newest-first with the limit, then reversed back to chronological — which is what "keep the last N" has to be in SQL.

Title derivation was fixed in the same change. It read `messages[0]`, which was the thread's first message *only because* history happened to be ordered oldest-first. Fixing the ordering would have silently started retitling long threads from whichever message fell at the window edge. The first message is now fetched explicitly — one extra query, on a path that runs once per conversation.

**Guarded by:** `npm run verify:api`, which inserts 45 messages with explicit spaced timestamps and asserts the window **ends with the newest** and **excludes the oldest**. A test asserting only "40 rows returned" would have passed the broken version.

### ISSUE-022 — Pre-publish audit: repository is clean, with three identifiers to decide on

**Status:** Open (decision, not a defect) | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-07-31
**Problem:** Before making the repository public, the working tree and all 42 commits of history were scanned for credentials and personal information.

**Clean — zero hits across every commit:**

| Scanned for | Result |
| --- | --- |
| Anthropic / OpenAI / Supabase secret / Resend / AWS key shapes | none |
| Private key blocks (`BEGIN … PRIVATE KEY`) | none |
| JWT-shaped strings | none |
| Postgres connection strings carrying a password | none |
| `.env` files ever committed | none — only `.env.example`, which holds placeholders |
| Absolute home paths (`/Users/…`) | none |
| Email addresses outside `example.com` / `example.invalid` | none |

**Three identifiers are present and are a judgement call, not a leak:**

1. **Supabase project ref** `uorgo…zje` — in `package.json` (the `db:link` script) and two wiki files. It is already public: it forms the `NEXT_PUBLIC_SUPABASE_URL` that every browser request carries, so anyone using the deployed app can read it. Publishing the repo reveals nothing new. It does make the project trivially *addressable* by a stranger — which is safe because RLS covers all ten tables and the publishable key is designed to be public, and `verify:rls` proves it. **Recommendation: leave it.** Removing it would mean hiding a value the app broadcasts anyway.
2. **Commit author** `Muhammad Bin Zeeshan <myaichatbot@proton.me>` — in every commit, unavoidable without rewriting history (which is forbidden and not worth it). This is the dedicated project address, not a personal one. **Recommendation: leave it.**
3. **`Sharaka workspace`** in `docs/mockups/02-obsidian.html` — demo text I wrote, derived from your other email address. Publishing it links this repository to a second identity for no benefit. **Changed to a neutral workspace name.** One edit to revert if you want it there.

**Resolution:** `npm run security:audit -- --history` now performs this scan on demand, so it is repeatable rather than a one-off. Run it before any future publish.

### ISSUE-021 — Dev overlay showed a permanent "1 Issue" on every page

**Status:** Resolved | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31
**Problem:** Reported as a 404-page problem, but it was not specific to the 404 — every page in development logged:

> `eval() is not supported in this environment. If this page was served with a Content-Security-Policy header, make sure that 'unsafe-eval' is included.`

React's **development** build uses `eval()` to reconstruct call stacks across the server/client boundary. Our `script-src` allows `'unsafe-inline'` but not `'unsafe-eval'`, so React's dev tooling was blocked. Nothing was broken — but a console that permanently contains an error is a console nobody reads, which is how the *next* real error gets missed.

**Resolution:** `contentSecurityPolicy()` in `next.config.ts` now takes a `dev` flag and adds `'unsafe-eval'` **in development only**. React never uses `eval()` in production, so the shipped policy is byte-identical to before — confirmed by diffing the built output. `verify:headers` was strengthened at the same time: it now calls the builder explicitly for both modes rather than reading whatever policy the current process happens to produce. The previous check would have passed in production and silently stopped testing anything the moment it ran under `NODE_ENV=development`.

**Also noticed while investigating:** anonymous requests to a non-existent path get a 307 to `/login`, not the themed 404 — the proxy gates first. That is correct (an anonymous visitor should not learn which paths exist) and the themed 404 is what a signed-in user sees.

### ISSUE-020 — Supabase CLI link state was lost; `db push` needs an explicit connection string

**Status:** Resolved | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31
**Problem:** `npm run db:push` failed with `LegacyProjectNotLinkedError`, and re-linking failed with `LegacyPlatformAuthRequiredError` — the CLI's link state (`supabase/.temp`) is machine-local and not in the repo, and re-linking needs a Supabase **personal access token** that only exists after an interactive `supabase login`.
**Resolution:** Migrations can be applied without any access token by passing the database URL directly:

```
npx supabase db push --db-url "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.<project-ref>.supabase.co:5432/postgres"
```

The password is already in `.env.local` as `SUPABASE_DB_PASSWORD`. Migration `20260731130001_auth_attempts.sql` was applied this way and confirmed by `npm run security:audit`, which reads the pg catalog and now reports **10** tables with RLS enabled. The `failed to cache migrations catalog: failed to run docker` warning it prints is cosmetic — it is the type-generation cache, which needs Docker (ISSUE-004), not the migration itself.

## Open

### ISSUE-019 — Two Dependabot PRs break the build (caught by CI on day one)

**Status:** Resolved | **Resolved:** 2026-07-31 — both PRs closed with the reason recorded on the PR itself. Dependabot reopens automatically when a compatible `eslint-config-next` ships, so nothing is lost by closing. Original detail below.

**Status (original):** Open | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-07-31
**Problem:** Dependabot opened six PRs within minutes of its config landing. CI failed two:
- **#6 eslint 9.39.5 → 10.8.0** — `eslint-config-next@16.2.12` bundles `eslint-plugin-react@7.37.5`, which is incompatible with ESLint 10: `TypeError: contextOrFilename.getFilename is not a function`. Not fixable from our side; it needs an `eslint-config-next` release that supports ESLint 10.
- **#5 typescript 5.9.3 → 7.0.2** — also fails.

**Action:** **close #6 and #5** rather than merging. Re-open when `eslint-config-next` supports ESLint 10.
The other four (#1 checkout, #2 setup-node, #3 production group, #4 @types/node) are green and safe to merge.
**Worth noting:** this is CI justifying itself on its first day. Both would have looked like routine version bumps.

### ISSUE-018 — Branch protection on `main`

**Status:** Resolved | **Severity:** Medium | **Phase:** 8 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31

**Problem:** `main` had nothing protecting it. Railway deploys from `main`
directly, so a red build reported but did not block a deploy, and any push —
including an accidental one — went straight to production. Setting a ruleset had
returned **403 Upgrade to GitHub Pro**, because branch protection on a *private*
repository is a paid feature.

**Resolution:** the repository was made public on 2026-07-31, which makes branch
protection free. It is now applied and **verified as enforcing**, not merely
configured.

### What is set

| Rule | Value |
| --- | --- |
| Required status checks | `Lint, type-check, build` · `Tests (credential-free)` |
| Branch must be up to date before merge | yes (`strict`) |
| Pull request required | yes |
| Approvals required | **0** |
| Administrators bound by these rules | **yes** |
| Force pushes | blocked |
| Branch deletion | blocked |
| Conversation resolution before merge | required |

The security-audit job is deliberately **not** a required check. It is advisory —
the dependency tree carries transitive advisories that cannot be cleared without
downgrading Next itself (ISSUE-006), so requiring it would block every merge
permanently and teach everyone to ignore the one check that reports real
findings.

### Proof that it enforces

Configuration is not enforcement. A direct push to `main` was attempted and
rejected:

```
$ git commit --allow-empty -m "test: confirm branch protection rejects a direct push"
$ git push origin main

remote: error: GH006: Protected branch update failed for refs/heads/main.
remote:
remote: - Changes must be made through a pull request.
remote: - 2 of 2 required status checks are expected.
remote:
 ! [remote rejected] main -> main (protected branch hook declined)
```

Both rules fired, and the account attempting it is a repository administrator —
which is the point of `enforce_admins`. The test commit was discarded locally
(`git reset --hard HEAD~1`); it never reached the remote.

The **opposite** direction was proven too: this very change was merged through a
pull request with CI green, so the legitimate path works. A rule that blocks the
intended workflow as well as the unintended one is worse than no rule.

### Re-checking it later

```bash
gh api repos/MyChat99/myaichat/branches/main/protection --jq '{
  checks: .required_status_checks.contexts,
  pr_required: (.required_pull_request_reviews != null),
  admins_bound: .enforce_admins.enabled,
  force: .allow_force_pushes.enabled
}'
```

### If you ever need to bypass it

You are bound by these rules now, including for a hotfix. That is deliberate.
The escape hatch is one command, and using it should feel like a decision:

```bash
gh api --method DELETE repos/MyChat99/myaichat/branches/main/protection
# ... push the fix ...
# then re-apply from the JSON block in DEC-016
```

**Still open, and a separate decision:** CI and the Railway deploy are not
chained. Railway watches `main` on its own, so it deploys whatever merges —
which is now always CI-green, but the deploy itself is not gated. Turning off
Railway's Auto Deploy and enabling the workflow's disabled deploy job is written
up in a comment in `.github/workflows/ci.yml`. Protection alone already fixes
the main risk.

### ISSUE-017 — Resend not configured: email is rendered but never sent

**Status:** Open (blocked on credentials) | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-07-31
**Problem:** No `RESEND_API_KEY`. `isEmailConfigured()` is false, so `lib/email/send.ts` uses a **console transport** — templates render and the calling code runs, but nothing is delivered.
**What you must add to `.env.local`** (and to Railway):

```
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com
```

Resend requires a **verified sending domain** — an unverified `from` address is rejected. Add and verify the domain at resend.com/domains first.
**Also outstanding:** task 7 of the phase file (routing Supabase's own auth emails through Resend) is **not done**. Supabase sends confirmation and reset emails from its own default sender; pointing them at Resend is a dashboard change (Authentication → Emails → SMTP) using Resend's SMTP credentials, not a code change.
**Verified regardless:** all four templates render, declare dark-mode styles, use inline CSS, and repeat every action link as copyable text (`npm run verify:email`, 23 checks).

### ISSUE-016 — Cloudflare R2 not configured: uploads cannot complete

**Status:** Open (blocked on credentials) | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-07-31
**Problem:** No R2 credentials, so `isStorageConfigured()` is false. Every upload path validates correctly and then returns `503 storage_unconfigured`; the UI disables its upload controls with an explanation rather than failing on click.
**What you must add to `.env.local`** (and to Railway):

```
R2_ACCOUNT_ID=...            # Cloudflare dashboard → R2 → account id
R2_ACCESS_KEY_ID=...         # R2 → Manage API tokens → Create (Object Read & Write)
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=myaichat
```

Keep the bucket **private** — no public access, no custom public domain. The app never issues a public URL; if the bucket is public, the "direct bucket URLs do not work" guarantee is broken from outside the code.
CORS on the bucket must allow `PUT` from your app origin, or browser uploads fail even with valid credentials.
**Verified regardless:** every rejection path — unauthenticated, wrong MIME, oversized, non-image avatar, another user's object (`npm run verify:storage`, 16 checks).

### ISSUE-015 — Verification suites share database state and interfere when chained

**Status:** Resolved | **Severity:** Medium | **Phase:** 8 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-31

**Resolution:** `npm run verify:all` — the runner this issue asked for. It does
four things a shell loop does not:

1. **Refuses to start on dirty state.** If a previous run died before its
   `finally`, a provider is disabled *right now*, and every later run builds on
   that. It is caught before anything executes, and the message names the fix.
2. **Orders the suites.** Credential-free first (a typo fails in two seconds,
   not after four minutes of database work), mutating suites last, never
   adjacent to a suite that reads what they break.
3. **Checks after each mutating suite**, so the blame lands on the suite that
   leaked rather than the next one to trip over it.
4. **Reports timings**, which is how the 22-second `verify:session` became
   visible as the slow one.

The dirt detector was **proved to fail** rather than assumed: setting
`rate_limit_messages_per_hour` to 1 makes the runner refuse to start and print
the remedy. A clean-state check that has never fired is a clean-state check you
are trusting on faith.

⚠️ **Still not safe to run against production while people are using it.**
Serialising removes the interference between suites; it does not remove the
seconds during which a provider genuinely is disabled. That remaining fix is a
separate Supabase project for tests — infrastructure, not code — and is tracked
in ROADMAP rather than here.

**Original report below.**

**Status (original):** Open | **Severity:** Medium | **Phase:** 8 | **Opened:** 2026-07-30
**Problem:** `verify:admin` mutates rows every other suite reads — it disables a provider and breaks a stored key, restoring both in `finally`. Run back-to-back with `verify:providers`, assertions in one can observe the other's mid-flight state. Chaining them against production produced four failures that all passed when each suite ran alone.
**Partly fixed:** the target provider is now chosen from an **ordered** query. It was unordered, so each run disabled a different provider and the same bug looked like a different one each time.
**Still open:** there is one Supabase project for local and production, so a suite that dies before its `finally` can leave a provider disabled for real users. Two fixes, either sufficient: a separate Supabase project for tests, or a `verify:all` runner that serialises the suites and asserts clean state between them. Phase 8's CI work is the natural place — CI must not be able to disable a provider in production.

### ISSUE-006 — 12 high-severity advisories in the stock Next.js dependency tree

**Status:** Open | **Severity:** Low | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** A clean `create-next-app` on Next 16.2.12 reports 12 high-severity advisories, all transitive: `minimatch`/`brace-expansion` DoS through the ESLint chain (dev-only), `postcss` source-map path traversal (build-time), and `sharp`/libvips CVEs (image optimization). None introduced by our code.
**Resolution:** Left as-is — `npm audit fix --force` would downgrade Next itself. Re-check at Phase 8 when CI is set up; most should clear via upstream patch releases. Revisit sooner if `sharp` ends up on a request path handling untrusted images.

### ISSUE-005 — `supabase gen types` needs Docker, so `lib/db/types.ts` is hand-maintained

**Status:** Open | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Type generation runs its introspection in a container, so it fails with `LegacyContainerRuntimeNotFoundError` without Docker. `lib/db/types.ts` is therefore written by hand and can silently drift from the migrations.
**Resolution:** Update `lib/db/types.ts` in the same commit as any migration change — noted in the file header and README. `npm run verify:schema` catches missing relations but **not** column-level drift. Resolves itself if Docker is installed (see ISSUE-004).

### ISSUE-004 — No local Supabase stack; migrations run against the hosted database

**Status:** Open | **Severity:** Low | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Docker is not installed, so there is no local Supabase stack. Migrations apply to the hosted project via `supabase db push`, and `supabase db reset --linked` would drop and recreate the **remote** database. Harmless while the project is empty; destructive once real data exists.
**Resolution:** Use `db push` for normal migration work; never `reset --linked` without confirming first. Install Docker and switch to a local stack before the project holds data worth keeping. See [DEC-004](DECISIONS.md).

### ISSUE-014 — Build required runtime environment variables, so the first deploy failed

**Status:** Resolved | **Severity:** High | **Phase:** 8 (pulled forward) | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `lib/env.ts` parsed the public schema at **module load**. Any import chain touching it therefore threw during `next build`, and Railway's first build died with `Failed to collect page data for /api/health` — a message that names the newest file rather than the actual cause, which sends you looking in the wrong place.
**Why it was invisible locally:** `.env.local` is always present on a dev machine, so the module-level parse always succeeded. The failure only appears where the variables are legitimately absent — which is every first deploy.
**Resolution:** `publicEnv` and `getServerEnv` are now lazy functions that throw a message naming the missing variable. A build no longer requires runtime config; a missing variable surfaces at request time instead of inside the bundler.
**Verified by** running `env -i npx next build` — a completely empty environment, reproducing the Railway condition. It now succeeds.
**Note:** `process.env.NEXT_PUBLIC_*` references are still written as full literals inside the function, because Next substitutes those exact strings at build time. Destructuring or computing the names would silently break client-side inlining.

### ISSUE-013 — Hand-maintained types drifted the moment a column was added

**Status:** Resolved | **Severity:** Low | **Phase:** 4 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** Adding `profiles.suspended` in migration `20260730120005` broke type-check in five files: `lib/db/types.ts` is hand-written (Docker is needed for `supabase gen types`), so the new column did not exist as far as TypeScript was concerned.
**Found by:** `npm run type-check`, immediately.
**Resolution:** Added the column to the `Row` and `Insert` shapes. This is [ISSUE-005](#) materialising exactly as predicted — worth noting that it failed *loudly and instantly*, which is the good case. The dangerous version is a column whose type changes rather than appears, since that can type-check while being wrong. Installing Docker and restoring generated types remains the real fix.

### ISSUE-012 — First OpenAI key was valid but unfunded

**Status:** Resolved | **Severity:** High | **Phase:** 3 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** The OpenAI key supplied for Phase 3 authenticated fine — HTTP 200 on `/v1/models` — but every completion returned `insufficient_quota`, including the cheapest model. OpenAI is prepaid with no free tier, and the account had no credit.
**Found by:** testing generation rather than authentication before building on the key. A models-list check would have reported it healthy.
**Resolution:** Replaced with a funded key, verified by an actual streamed completion. The lesson is encoded in [DEC-011](DECISIONS.md): `validateKey()` on every adapter performs a real generation, so Phase 4's "Test Connection" button cannot show a green tick for a key that can't work.

### ISSUE-010 — Phase 2 blocked: no Anthropic API key

**Status:** Resolved | **Severity:** High | **Phase:** 2 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30 (recorded 2026-07-31)
**Resolution:** A key was provided on 2026-07-30 and Phase 2 shipped the same day; `verify:chat` has been streaming real completions through it ever since. **This entry stayed marked Open for a day after it was fixed** — caught during the pause audit, not by anything automatic. An issue log that lags reality is worse than no log, because the next person plans around a blocker that no longer exists.
**Problem:** [PHASE-2-chat-streaming.md](../phases/PHASE-2-chat-streaming.md) specifies Anthropic as the single provider for Phase 2. No Anthropic key exists. An OpenAI key is available but was deliberately deferred to Phase 3 rather than swapping the provider order — see [DEC-007](DECISIONS.md).
**Resolution:** Get a key from console.anthropic.com, add `ANTHROPIC_API_KEY` to `.env.local`, then Phase 2 can start. Nothing else blocks it — Phase 1 is Verified.

### ISSUE-003 — R2 and Resend credentials not yet provisioned

**Status:** Open | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-07-30 | **Resolved:** —
**Rescoped 2026-07-31:** Railway is done — provisioned, deployed and live since 2026-07-30 — so this now covers **R2 and Resend only**. Phase 8 dropped from the scope.
**Problem:** No accounts or keys yet for Cloudflare R2 or Resend. Both block Phase 6 at the point of integration; everything up to that point is built and tested. See [PHASE-6-CHECKLIST.md](PHASE-6-CHECKLIST.md) for the exact sequence once they exist.
**Resolution:** Provision per phase as needed. Track every new variable in `.env.example`; real values go in Railway, never in the repo.

### ISSUE-001 — Commit author email may not match GitHub account

**Status:** Resolved | **Severity:** Low | **Phase:** 0 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-31
**Resolution:** Confirmed empirically now that the repository is public — the API reports every commit linked to the profile, so the address is verified on the account and contributions are attributed:

```bash
gh api repos/MyChat99/myaichat/commits --jq '.[0:3][] | {sha: .sha[0:7], linked_login: (.author.login // "NOT LINKED")}'
# → all three: "linked_login": "MyChat99"
```

Original concern below.
**Problem:** Git commits are authored as `myaichatbot@proton.me`, but the GitHub account is `MyChat99`. If that address is not verified on the account, commits will not link to the profile and contributions will not be attributed.
**Resolution:** Add and verify the address at github.com/settings/emails, or change `git config --global user.email` to the account's verified address. Cosmetic only — does not affect pushes.

---

## Resolved

### ISSUE-011 — Proxy redirected unauthenticated API calls to the login page

**Status:** Resolved | **Severity:** Medium | **Phase:** 2 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `proxy.ts` matched `/api/*` and redirected unauthenticated requests to `/login` with a 307. A default `fetch` follows redirects, so an unauthenticated `POST /api/chat` came back as **200 with an HTML login page** — and the route handler's own 401 was unreachable. Any client treating 200 as success would have parsed HTML as a chat stream.
**Found by:** `npm run verify:chat`. The first version of that check used a default `fetch` and reported the followed redirect's 200 as the endpoint's status, so the assertion caught the symptom but the diagnosis needed `redirect: 'manual'`.
**Resolution:** `updateSession` now returns early for `/api/*` — the session cookie is still refreshed, but no redirect is issued, so route handlers return a real JSON 401. The check now asserts both the 401 **and** a JSON content-type with `redirect: 'manual'`, so a regression can't hide behind a followed redirect again.

### ISSUE-009 — Self-referential `--font-sans` made every page render in serif

**Status:** Resolved | **Severity:** Low | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `shadcn init` wrote `--font-sans: var(--font-sans)` into the `@theme inline` block in `app/globals.css`. A variable defined as itself resolves to nothing, so `font-sans` fell through to the browser default and the whole app rendered in Times-style serif — not the Geist the layout loads, and not the "refined typography" the spec calls for.
**Found by:** looking at the running app during the Phase 1 browser walkthrough. Lint, type-check, build and all 41 automated checks passed with this bug present — nothing in the current suite can see rendered output.
**Resolution:** Point the theme variables at the names `app/layout.tsx` actually defines (`--font-geist-sans` / `--font-geist-mono`). Worth remembering that visual regressions are invisible to this test suite; Phase 7's Lighthouse pass is the first automated check that would plausibly catch a class of them.

### ISSUE-008 — Seed script crashed on a null-valued system setting

**Status:** Resolved | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** `npm run seed` failed with `null value in column "value" of relation "system_settings" violates not-null constraint`. The script seeded `{ key: 'default_model_id', value: null }`, but `system_settings.value` is `jsonb NOT NULL` and PostgREST sends a JS `null` as SQL NULL, not JSON `null`. The run aborted after creating the admin user but before the settings insert, leaving the database half-seeded.
**Resolution:** `default_model_id` is no longer seeded — no models exist until Phase 3, and a row pointing at nothing is worse than an absent row since readers must handle the missing case either way. Phase 3 inserts it once there is a real model to name. The settings type is now `NonNullable<…>`, so a null value is a type error rather than a runtime failure.
**Also hardened:** the seed is now provably re-runnable. The email is trimmed and lowercased before lookup (Supabase stores lowercase, and `.env.local` had a leading space), and a 422 "already registered" from `createUser` adopts the existing account instead of throwing. Confirmed by running the seed three times, then `npm run verify:seed` — exactly one auth user, one admin profile, four settings, no nulls. That check is committed so the regression cannot come back silently.

### ISSUE-007 — Infinite recursion in the profiles UPDATE policy blocked all profile edits

**Status:** Resolved | **Severity:** High | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** The first `profiles` UPDATE policy pinned `role` with a `WITH CHECK` subquery reading `public.profiles`. A policy **on** a table that SELECTs **from** that table re-enters its own policy set, so Postgres aborted every normal-user profile update with `42P17 infinite recursion detected in policy for relation "profiles"` — display-name changes included. It blocked privilege escalation only by failing outright, which looked like a pass in the first version of `verify:rls`.
**Found by:** `npm run verify:rls`, then confirmed by reading the role back with the secret key rather than trusting the response.
**Resolution:** Migration `20260730120004_fix_profile_role_guard.sql`. The policy is now a plain ownership check; `role` is pinned by a `BEFORE UPDATE` trigger that reverts changes unless the caller is `service_role` or already an admin. `verify:rls` now asserts against the stored value and also checks that a legitimate display-name update still succeeds. Note `public.is_admin()` never recursed — it is `SECURITY DEFINER` and owned by the table owner; the bare subquery was the bug. See [DEC-005](DECISIONS.md).

### ISSUE-002 — Supabase credentials not yet provisioned

**Status:** Resolved | **Severity:** Medium | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** 2026-07-30
**Problem:** No Supabase project or keys existed, blocking all of Phase 1 (auth, schema, RLS).
**Resolution:** Project `uorgodndubyznjzotzje` provisioned. URL, publishable key, secret key, and DB password stored in `.env.local` at the repo root — gitignored via `.env.*` and verified untracked. Keys use Supabase's new format, see [DEC-003](DECISIONS.md). Originally also covered R2/Resend/Railway; those were split out to ISSUE-003.
