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

### ISSUE-066 — `/api/health` cannot say which build is deployed

**Status:** Open | **Severity:** Low | **Phase:** 8 | **Opened:** 2026-08-03
**Problem:** the endpoint returns `{"status":"ok","checks":{"database":"ok","encryption":"ok"}}` and no version. There is no way to ask the deployment which commit it is serving, so "has my fix landed?" can only be answered by probing for a behavioural change — a header, a rendered pixel — which is indirect and needs a new probe per change. Verifying the ISSUE-065 deploy meant polling the CSP header in a loop.
**Resolution:** expose the commit SHA (Railway provides `RAILWAY_GIT_COMMIT_SHA`) and the build time. Cheap, and it turns every future deploy check into one request. Not done as part of ISSUE-065 to avoid a third concurrent branch.

### ISSUE-065 — Avatars have never displayed in production: CSP blocked the redirect target

**Status:** **Resolved 2026-08-03 — verified in production** | **Severity:** Medium | **Phase:** 6/7 | **Opened:** 2026-08-03

**Proof, same check either side of the deploy**, signed in as the owner on the live site:

```
before    avatar-shaped images: 2    0x0        CSP violations: 1
after     avatar-shaped images: 2    1320x2868  CSP violations: 0
```

`naturalWidth` is the assertion, not the presence of the tag — the broken version had an `<img>` that was present, had a same-origin `src`, and laid out.

**Problem:** every avatar on the deployed site was blocked by our own Content Security Policy. Found by loading `/` as the owner's account and reading the console — not by any test.

```
Loading the image 'https://myaichat.<account>.r2.cloudflarestorage.com/avatar/…jpg?X-Amz-…'
violates the following Content Security Policy directive: "img-src 'self' data: blob:".
The action has been blocked.
```

**Why it survived every upload test.** The `<img>` src is our own origin — `/api/uploads/download?key=…` — which looks like `'self'` and passes any check that reads the markup. The route then **302s to a presigned R2 URL**, and CSP is evaluated against the URL the browser actually fetches, i.e. *after* the redirect. So the tag is same-origin, the policy is violated by a host that never appears in the HTML, and the violation names our own page. Uploading always worked; only *displaying* was broken, and no suite looked at a rendered avatar.

**The specific oversight:** `connect-src` was given both R2 hosts when presigned PUT was fixed, and the comment in `next.config.ts` explains that failure mode in detail. `img-src` was never given the same treatment — the same hosts, the same reason, one directive apart.

**Resolution:** `img-src` now interpolates the same `r2` host list as `connect-src` ([next.config.ts:77](../../next.config.ts#L77)). Both are still listed explicitly rather than as a wildcard, so no other tenant's bucket on Cloudflare's shared domain is admitted.

**Two things were tightened rather than just the bug fixed:**

- `verify:headers` now asserts the R2 hosts **per directive**. It previously substring-matched the whole policy, so a host present in `connect-src` alone satisfied a check named after it — a policy with this exact bug went green. Break-tested: reverting `img-src` turns 29/29 into 2 failures naming the directive.
- `smoke:signed-in` fails on any console error during a signed-in walk with a real uploaded avatar, which is the check that would have caught this from the outside.

**Standing lesson:** a CSP check that reads the HTML cannot see a redirect. The only reliable test is a browser loading the real page and reporting violations.

### ISSUE-063 — Supabase Auth returns 500 on sign-up in production

**Status:** Closed 2026-08-03 — **won't fix, this is the intended posture** | **Severity:** ~~High~~ n/a | **Opened:** 2026-08-03
**Closed by the owner with the reasoning recorded, because the reasoning is the point.** Sign-ups are disabled at the **Supabase project level**, deliberately, in addition to the application's own switch. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is public by design — it ships in the client bundle — so anyone can call Supabase's auth endpoints directly, and an application-level gate alone would not stop them. Both gates stay shut.
**What that means for the break-test:** the "flip on → registration succeeds" half is unachievable by design, not by defect, and is not worth chasing. The closed direction is the one that matters and is proven against the live site: the app refuses first with *"New accounts are closed on this deployment"*, and behind it Supabase refuses too.
**What was fixed off the back of it:** the sign-up action no longer passes the upstream message through, so nobody sees the literal `{}` — and, more importantly, no upstream text reaches the reader at all, since "User already registered" answers a question about who has an account here. `verify:spend` asserts both.
**Access for real users** is via `npm run accounts:create`, verified end to end: a script-created account signs in on the deployed site, keeps its session across a reload, and lands on a working chat page.

**Original diagnosis, kept for the record:**
**Problem:** self-service registration is broken in production, independently of this application. Reproduced with the raw `supabase-js` anon client, no app code involved:

```
AuthRetryableFetchError  status 500  message "{}"
user created: no
```

**Where it is NOT.** The sign-up policy works: with `signups_enabled` false the server refuses first with *"New accounts are closed on this deployment. Ask an administrator for access."* This 500 happens after that gate, inside Supabase's auth service.
**Most likely cause,** consistent with [ISSUE-060](#issue-060): Supabase cannot send the confirmation email, so the sign-up transaction fails. Supabase auth mail goes through the project's own SMTP settings, not through the app's Resend client, so setting `RESEND_API_KEY` in Railway does not affect it.
**Consequence for the break-test:** the "flip on, registration succeeds" half cannot be demonstrated through the UI until this is fixed. The "flip off, rejected server-side" half is proven against production.
**Second, smaller defect this exposed:** our sign-up action passes `error.message` straight through, so the user is shown the literal string `{}`. Whatever the upstream failure, that is not a message anyone can act on.
**To close (needs the owner):** Supabase dashboard → Authentication → Emails/SMTP. Either configure SMTP that works, or disable "Confirm email" so sign-up completes without one. Then re-run the break-test.

### ISSUE-060 — Email is configured in production but delivery is unproven

**Status:** Open | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-08-03
**Correcting my own audit.** I reported that a missing `RESEND_API_KEY` would silently fall back to the console transport. The owner confirms **`RESEND_API_KEY` is set in Railway**, so that is not what is happening: `isEmailConfigured()` returns true and the Resend transport is live. The likely blocker is an **unverified sending domain** — `onboarding@resend.dev` only delivers to the address that owns the Resend account, so mail to any other recipient is accepted by the API and never arrives.
**Why that is the worse failure mode:** the console fallback is loud in a log. This one succeeds at every layer we can see — the API returns a message id — and fails silently at the recipient. Nothing in this app can tell the difference.
**To close:** verify a sending domain in Resend, set `RESEND_FROM_EMAIL` to an address on it, and confirm a real signup mail arrives at an address that does not own the Resend account. Related: [ISSUE-017](#issue-017).

### ISSUE-064 — The verification suites run against the PRODUCTION database

**Status:** Open | **Severity:** **High** | **Tier:** roadmap | **Opened:** 2026-08-03
**Problem:** every suite that needs data — `verify:pages`, `verify:spend`, `verify:costs`, `verify:failures`, `verify:documents:e2e`, `verify:providers`, `verify:keepalive` and the rest — creates users, models, providers, conversations and settings in the **live** Supabase project. There is no separate test database.
**This is not theoretical; it happened today.** Runs killed mid-execution left behind, in live data:

| Leaked | Why it mattered |
| --- | --- |
| 10 test accounts | noise in the user list |
| **4 of them with `role = 'admin'`** | real privilege on real data |
| a `Broken press (failure test)` model on `anthropic` | other suites picked it as their model and failed on it |
| a `test-provider-9239` provider row | visible on `/admin/providers` |

**Why better cleanup is the wrong fix.** Every one of those suites already has cleanup in `finally`. `finally` does not run when the process is killed — by a timeout, by `pkill`, by a machine going to sleep — and that is exactly how each of these escaped. Any amount of additional diligence inside the test has the same hole.
**The fix is isolation, not tidiness:** a second Supabase project used by `verify:*`, selected by environment, with the production URL refused outright when a test env var is set. That also removes the shared-state coupling that makes suites interfere when chained, and would let them run in parallel.
**Estimated:** 4–6 hours, most of it applying the 21 migrations to a second project and threading the connection through `scripts/_env.ts`. Blocked on the owner creating that project — it is their Supabase account.
**Interim mitigation, which is not a fix:** admin-role test accounts are the worst of it, and only `verify:pages` needs one. Until isolation exists, an audit of leaked test rows is worth running after any interrupted session.

### ISSUE-059 — The whole verification suite runs against `next dev`

**Status:** Open | **Severity:** **High** | **Tier:** roadmap | **Opened:** 2026-08-03
**Problem:** every browser suite — `verify:pages`, `verify:costs`, `verify:failures`, `verify:motion`, `verify:documents:e2e` — points at `npm run dev`. A whole class of defect exists only in a production build and is therefore invisible to all of them.
**Proven by a real outage, not by argument.** A Server Component calling a function exported from a `'use client'` module ([ISSUE-061](#issue-061)) returned 500 in production while `tsc`, `next build`, `next dev` and 34 green suites all passed simultaneously. In dev the real function is still there; in a production build it is a client reference and calling it throws.
**What it would take:** a `verify:prod` mode that runs `next build`, starts `next start` on a spare port, and re-runs the browser suites against it. Most of the machinery exists — every suite already accepts `--base`/`BASE_URL`. The work is a build step in the runner (~2–4 minutes per run), deciding which suites are worth the wall-clock, and a fixture that has an avatar so the path that broke is actually exercised. **Estimate: 3–4 hours.**
**Interim cover:** `verify:boundaries` catches this specific class statically, in milliseconds. It does not cover the class of "only breaks in a production build" generally.

### ISSUE-061 — Production 500: a Server Component called a client function

**Status:** Resolved 2026-08-03 | **Severity:** **Critical** | **Opened:** 2026-08-03 | **Resolved:** 2026-08-03
**Problem:** `/` returned 500 for any signed-in account with an avatar. Digest `414204945`: *Attempted to call attachmentUrl() from the server but attachmentUrl is on the client.* `attachmentUrl` lived in `lib/upload/client.ts` (`'use client'`); `AvatarMark` has no directive and is rendered by the app shell on every authenticated page.
**Why nothing caught it:** four layers passed at once — `tsc` (types are real, only the runtime value is a proxy), `next build` (a render-time failure), `next dev` (keeps the real function), and the suite ([ISSUE-059](#issue-059)). The call is guarded by `avatarKey ?`, so it fired only for accounts with an uploaded portrait, and every test account this repo creates has none.
**Resolution:** moved to `lib/upload/urls.ts`, a module with no directive. `verify:boundaries` guards the class and was break-tested against the original defect. An audit of 93 server/shared modules against 32 client modules found no other instance. Deployed and confirmed: `/` 200 signed in with an avatar, `/login` 200 signed out.

### ISSUE-062 — The provider env-key fallback is dormant here, not absent

**Status:** Open — accepted risk | **Severity:** Low | **Opened:** 2026-08-03
**Correcting my own audit.** I listed the `*_API_KEY` env fallback in `getProviderKey()` as a live silent-fallback risk in production. The owner confirms **no `ANTHROPIC_/OPENAI_/GROQ_/PERPLEXITY_API_KEY` variables are set in Railway at all**, so there is no second spend source on this deployment and admin-panel keys are already the only one.
**The code path still exists**, and is the supported way a fresh checkout works before anyone opens the admin panel. The risk it describes — deleting a key in the admin panel while an env var quietly keeps that provider alive — is real for any deployment that does set them. Left as-is and documented rather than removed.

### ISSUE-058 — Free-tier sustainability across four services
**Status:** Open | **Severity:** Medium | **Tier:** cross-cutting | **Opened:** 2026-08-03
**Problem:** Railway, Supabase, R2 and Resend all have limits this app can reach, and provider API spend is not a free tier at all. No document states current usage against each limit, what happens as one is approached, or what to do having outgrown it.
**Deliverable:** `docs/wiki/FREE-TIER-OPERATIONS.md`. Specific risks: Supabase inactivity pause ([ISSUE-047](#issue-047)), R2 growth from attachments and any future audio/video, Railway memory/CPU for processing, Resend send ceilings, and provider spend ([ISSUE-048](#issue-048)).

### ISSUE-057 — Scheduled messages and tasks
**Status:** Open | **Severity:** Low | **Tier:** 4 | **Opened:** 2026-08-03
**Problem:** No way to run a prompt on a schedule. Wants one-off and recurring, results into a conversation and optionally emailed, a Scheduled page with upcoming/past runs and cost, per-user limits so a runaway schedule cannot drain spend, and an admin toggle. Shares its mechanism with [ISSUE-047](#issue-047).

### ISSUE-056 — Audio and video input
**Status:** Open — **needs infrastructure confirmation before any code** | **Severity:** Low | **Tier:** 4 | **Opened:** 2026-08-03
**Problem:** No speech or video input. Audio would need server-side transcription; video needs audio extraction plus sampled keyframes, and the UI must be honest that the model sees frames rather than video.
**Blocked on a question only the owner can answer:** video requires `ffmpeg` on Railway. Memory footprint, cost and feasibility on the current plan must be confirmed before writing code.

### ISSUE-055 — Moderation and three-strike enforcement
**Status:** Open | **Severity:** Medium | **Tier:** 4 | **Opened:** 2026-08-03
**Problem:** Nothing checks message content before a provider call. Wants warning → final warning → suspension requiring admin reinstatement, an admin queue with context and reversible actions, all audit-logged.
**Design constraint already decided:** use a moderation API as the primary signal — OpenAI's is free and already in-stack — not a wordlist, and it must distinguish abuse aimed at a person from ordinary profanity, quoted text, or clinical discussion. Every strike visible to the user with its reason, and reversible.

### ISSUE-054 — Sidebar is a flat chat list, not a navigation column
**Status:** Open | **Severity:** Low | **Tier:** 3 | **Opened:** 2026-08-03
**Problem:** The sidebar holds only conversations. Wants an action group (Start a page, Temporary chat, Search), a navigation group (Presses, Scheduled, Folders, Usage), conversations grouped as now, and a bottom account row — collapsible, state persisted, tidy at 360px, keyboard navigable, in the press language rather than a copy of another product.

### ISSUE-053 — Admin panel cannot control the product without code
**Status:** Open | **Severity:** Medium | **Tier:** 3 | **Opened:** 2026-08-03
**Problem:** Feature flags, per-model parameters and system prompts, per-role limits, signup controls, branding, email preview and test send, storage overview and orphan purge, announcements, bulk user actions and richer analytics all require a code change or a SQL console.
**Privacy line, decided:** admin access to conversation CONTENT is excluded by default. Any support-oriented view must be consent-gated and audit-logged, never silent.

### ISSUE-052 — No account menu, and no response-language control
**Status:** Open | **Severity:** Low | **Tier:** 3 | **Opened:** 2026-08-03
**Problem:** Navigation is loose links. Wants a grouped account menu (Profile, Appearance, Usage, Language, Admin, Help, Sign out) and a language submenu of 50+ languages, each in its own script, with a search filter.
**Decided:** implement RESPONSE language now — the model replies in the chosen language — plus i18n plumbing and RTL layout support so interface translation can follow later. **Do not claim 50 translated interfaces the app cannot deliver.**

### ISSUE-051 — Avatars are a placeholder glyph or nothing
**Status:** Open | **Severity:** Low | **Tier:** 2 | **Opened:** 2026-08-03
**Problem:** No avatar library. Wants preset avatars drawn in the press language (two-colour ink, hard edges, halftone), a custom builder, SVG so it costs no storage, and a deterministic default from the user id so nobody sees an empty frame. Photo upload still wins. Correct in all 14 palette-and-mode combinations.

### ISSUE-050 — No tone control over how the model answers
**Status:** Open | **Severity:** Medium | **Tier:** 2 | **Opened:** 2026-08-03
**Problem:** Every conversation gets one system prompt. Wants seven presets producing genuinely different output — Neutral, Direct, Warm, Socratic, Beginner, Expert, Critical — stored per conversation, shown on the sidebar card, switchable mid-conversation with the change visible in the transcript, applied to Presses too so comparisons stay fair, with custom named modes and admin control of the preset prompts.

### ISSUE-049 — No temporary / off-the-record conversation
**Status:** Open | **Severity:** Medium | **Tier:** 2 | **Opened:** 2026-08-03
**Problem:** Every message is persisted. Wants a mode that is not stored, not in the sidebar, not searchable or exportable, gone on refresh, with an unmistakable visual state and a warning before navigating away.
**Decisions still to make:** whether attachments in this mode are deleted from R2 after the request or blocked outright. Usage rows must still record for billing integrity but **without message content**, and the UI must state plainly what is and is not kept.

### ISSUE-048 — Provider keys pay for every stranger's message
**Status:** Open | **Severity:** **High** | **Tier:** 1 | **Opened:** 2026-08-03
**Problem:** The owner's API keys fund every message anyone sends. Before this is shared publicly it needs a global monthly spend ceiling with a hard cutoff, tight default per-user daily budgets, real-time admin visibility of spend, and signup control (invite-only / domain allowlist / open).
**Why it is the highest-severity item in this list:** every other issue costs time. This one costs money, to a stranger's schedule.

### ISSUE-047 — Supabase pauses on inactivity and nothing prevents it
**Status:** Open | **Severity:** High | **Tier:** 1 | **Opened:** 2026-08-03
**Problem:** A free Supabase project pauses after a period without activity, taking the whole app down. Wants three layers: a cheap rate-limited ping on any arrival including the signed-out page; a manual admin PING showing result, timestamp and latency; and a scheduled ping independent of traffic, because if nobody visits for a week the first two never run.
**Flag before implementing:** the scheduled layer touches infrastructure the owner owns.

### ISSUE-046 — The error page lies and its button does nothing
**Status:** Open | **Severity:** Medium | **Tier:** 1 | **Opened:** 2026-08-03
**Problem:** Two defects. (a) The copy promises "the digest below will help track it down" and no digest is shown — only "Reference: <number>" — and it is unverified whether that reference can find the server-side log entry at all. (b) "Try again" is clickable and does nothing.
**Root cause worth naming:** nobody ever opened these pages. A visibly dead button shipped because the error boundaries were never triggered in a browser.

### ISSUE-045 — Destructive confirmations use the browser's native dialog
**Status:** Open | **Severity:** Low | **Tier:** 1 | **Opened:** 2026-08-03
**Problem:** Deleting a conversation uses `confirm()` — a white system dialog, completely off-design, with no press treatment and no control over focus or motion. Wants a press-styled dialog (paper stock, 2px ink, offset shadow, mono caps, zero radius, ink-wash backdrop), stamp-in motion, Esc cancels, Enter confirms, focus trapped and returned, 360px, motion collapsing under reduced-motion — then every other native `confirm`/`alert`/`prompt` in the app replaced with it.

### ISSUE-044 — The sent message is a box with one action
**Status:** Open | **Severity:** Low | **Tier:** 1 | **Opened:** 2026-08-03
**Problem:** User messages render inside an outlined box, and offer only Copy. Wants the box gone entirely, an Edit action (edit and resubmit, already implemented elsewhere), and a third action no other chat app can offer.
**Note:** re-running a prompt on another model already exists on the cost comparison rows, so the third action must either surface that same capability consistently from the user message with the same guards, or be something else — and the choice must be stated.

### ISSUE-043 — The composer has a redundant inner box
**Status:** Open | **Severity:** Low | **Tier:** 1 | **Opened:** 2026-08-03
**Problem:** The "Write here…" textarea sits inside its own outlined rectangle, nested within the COMPOSE panel's hard border. Two borders around one field reads as unfinished. Keyboard focus must stay clearly visible by other means.

### ISSUE-042 — Office extraction was only ever proven against fixtures I generated

**Status:** Resolved 2026-08-02 | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-08-02
**Problem:** `.docx` and `.xlsx` extraction is a hand-written OOXML reader, and every test fed it files built by `scripts/_fixtures.ts` — files shaped exactly the way the parser expects. A parser proved correct only against its author's own fixtures is proved very little: real Word and Excel output carries style runs, `xl/` layouts, relationship ordering and shared-string shapes that a minimal generator never produces.
**Resolved — verified by the owner against real Microsoft-authored files.** A `.docx` and an `.xlsx` uploaded **together in one message**, and the model returned, correctly:

| From | Retrieved |
| --- | --- |
| Word document | `QVX-7741`, `Marisol Okonkwo-Brandt`, `PERIWINKLE-9` |
| Spreadsheet, sheet 1 | Marisol Heights as highest revenue, **$49,484.50** — a computed column, read correctly |
| Spreadsheet, sheet 2 | all three Anomalies rows |

So three separate things hold on real files and not just on fixtures: **multi-file** attachment in one turn, **multi-sheet** extraction reached through the relationship file rather than by guessing filenames, and **computed cell values** — Excel stores the cached result in `<v>`, which is what the extractor reads.
**What is still not proven:** `.doc`/`.xls` (the pre-2007 binary formats) are not accepted at all and are refused by type; password-protected and macro-enabled files are untested. Both fail as "could not be read" rather than silently.

### ISSUE-041 — `verify:persistence` failed once in a chained run and passed alone

**Status:** Open — flake, cause unconfirmed | **Severity:** Low | **Phase:** 7 | **Opened:** 2026-08-02
**Problem:** One `verify:all` run reported `verify:persistence` as the only failing suite. Re-run standalone: pass. Re-run inside a full `verify:all`: pass. Two clean runs do not make the first one imaginary.
**Most likely cause, stated as a hypothesis and not as a finding:** that suite asserts *"no navigation took longer than 2s"*, and the failing run happened while I was driving a browser against production and a full local suite at the same time. A wall-clock threshold on a loaded machine is exactly the kind of assertion that fails once and cannot be reproduced.
**Why it is logged rather than fixed:** loosening a timing threshold to stop a flake is how a real performance regression gets hidden. If it recurs, the fix is to measure navigation against a baseline rather than a constant.

### ISSUE-040 — A test harness can only `eval` where the CSP is loose

**Status:** Resolved 2026-08-02 | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-08-02
**Problem:** `verify:upload` run against production reported *"the upload never completed"* and failed *"the browser PUT the file to the bucket"* — on a deployment where the upload had succeeded in 4.5s in that same run. The message was invented by the harness.
`page.waitForFunction` injects its poller into the page, so a string expression is `eval`, and our own production CSP (`script-src 'self' 'unsafe-inline'`, no `'unsafe-eval'`) refuses it. It threw `EvalError` 11ms in — not at the 30s timeout — and the `.catch()` printed a network summary instead of the error.
**It passed locally the whole time**, because Next's dev CSP allows `unsafe-eval`. A browser suite that only works against a loose CSP is a suite that cannot check the deployment it exists to check.
**Resolution:** polled through `page.evaluate` instead, which runs via CDP's `callFunctionOn` rather than the page's script loader and is not subject to page CSP (PR #67). This was the only `waitForFunction` in the repo.
**A second defect in the check beside it:** `[].every()` is `true`, so *"the bucket accepted it"* reported `ok` on no evidence — passing in the same run where the check above it failed for having seen no PUT. It now requires at least one observed PUT.
**Carry forward:** prefer `page.evaluate`; if a `waitForFunction` is ever needed, pass a function, not a string.

### ISSUE-031 — Untagged demo usage rows predate the fix and cannot be identified

**Status:** Open — needs your decision | **Severity:** Low | **Phase:** 7 | **Opened:** 2026-08-01
**Problem:** `--demo` wrote fabricated `usage_logs` rows with nothing marking them, and `--clean-demo` could not remove them ([ISSUE-030](#issue-030)). That is fixed going forward — new demo rows carry `source = 'demo'` — but the rows written **before** the fix are still there and are indistinguishable from real usage by the same argument that caused the bug.
**Measured 2026-08-01:** 366 rows in `usage_logs`, none tagged, no exact duplicates (each seed run randomises token counts, so re-runs do not collide). For scale: this project has ~178 real messages, and each demo run wrote ~82 rows.
**Re-measured 2026-08-02, and the number I gave you was wrong.** 366 was the size of the *whole table* at the time; I quoted it as the number of deletion candidates, including in the overnight report. Counted properly, against the discriminator this issue actually proposes:

| | rows |
| --- | --- |
| `usage_logs`, total | 846 |
| tagged `source = 'demo'` (removable by `--clean-demo`) | 49 |
| untagged, any date | 797 |
| **untagged AND before 2026-07-30 — the candidates** | **75** |

Oldest row in the table is 2026-07-02; the newest candidate is 2026-07-29. Deleting the 75 would remove **23,994 tokens and $0.0779** from the analytics totals. The other 722 untagged rows are dated on or after the first commit and are indistinguishable from real usage — they stay, whatever you decide.
**Why I did not clean them:** there is a defensible discriminator — the project's first commit is 2026-07-30, so any row dated before that is necessarily fabricated — but acting on it means deleting analytics data on my own inference. That is your call, not mine.
**If you want them gone:** `delete from usage_logs where created_at < '2026-07-30' and source is null;` — check the count with a `select` first.

### ISSUE-030 — `--clean-demo` could not remove what `--demo` wrote

**Status:** Resolved | **Severity:** Medium | **Phase:** 7 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** Two duplicate bugs in the demo seeder, both visible in screenshots — the thing the seeder exists for.
1. **Duplicate titles.** A fixed 30-day × 2-per-weekday loop indexed into the template pool modulo its length: 52 conversations drawn from **6 templates**, so every title appeared about nine times. Measured before the fix: 52 conversations, **5 unique titles**.
2. **Duplicate usage rows.** `usage_logs` had no column marking a fabricated row, so cleanup deleted the conversations and left every usage row behind — and the "already present?" guard only looked at conversations. So `--clean-demo` then `--demo` passed the guard and wrote a second full set. Spend and per-model totals counted both, permanently.
**Resolution:** A new nullable `usage_logs.source` column (migration `20260801120000`); demo rows set it, cleanup deletes on it, and the guard checks both tables. The loop is now driven by the pool, so each template is used exactly once and no title can repeat — the pool size *is* the amount of data. Pool expanded from 6 to 24 threads.
**Proven:** 366 → 395 → 366 across `--demo` / `--clean-demo`, and 24 conversations with 24 unique titles. Pre-existing untagged rows are [ISSUE-031](#issue-031).

### ISSUE-039 — Perplexity spend is under-reported: search fees are not tokens

**Status:** Open — known limitation | **Severity:** Low | **Phase:** 3 | **Opened:** 2026-08-02
**Problem:** Perplexity's Sonar models bill per *search request* as well as per token, and `usage_logs` records only input and output tokens. Analytics and the daily token budget will therefore understate Perplexity spend by whatever the search component costs.
**Why it is not a bug:** every other provider bills purely per token, and the cost model was built for that. Adding a per-request fee column would be a schema change, a migration, and a change to every aggregation — for one provider, on a deployment that has no Perplexity key configured.
**Raised from cosmetic to user-facing on 2026-08-02.** Per-answer prices are now shown to the user (PR #49). An understated number on an admin dashboard is a reporting gap; the same number printed under a user's answer is a claim to them about what they were charged. Severity stays Low only because no Perplexity key is configured on this deployment, so no such price can currently be displayed. **If a Perplexity key is ever added, this becomes High and must be fixed before that provider is enabled.**
**Mitigated:** `sonar-deep-research`, whose search and citation fees dominate its cost, is deliberately not seeded — see the note in `lib/providers/perplexity.ts`.
**Revisit** if Perplexity is actually used in anger, or if a second provider with non-token billing is added.

### ISSUE-038 — Browser uploads were blocked by our own CSP, not by CORS

**Status:** Resolved | **Severity:** High | **Phase:** 6 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-02
**This is Phase 6 human check #1, finally performed — by a script.** It failed, and my first diagnosis was wrong.
**Problem:** the browser's `PUT` to R2 never left the page and the attachment chip sat on "Uploading…" forever.
**Misdiagnosed as CORS.** The browser's summary — `Fetch API cannot load https://myaichat.<account>.r2.cloudflarestorage.com/…` — reads exactly like a CORS refusal, and the owner re-saved the bucket policy on that advice. It was not the cause. An `OPTIONS` preflight sent straight at the bucket answered correctly all along: `Access-Control-Allow-Origin: http://localhost:3000`, `Allow-Headers: content-type`, `Allow-Methods: PUT, GET, HEAD`.
**Actual cause — our own Content Security Policy.** The full console message, which my harness was truncating, said:

> `violates the following CSP directive: "connect-src 'self' … https://<account>.r2.cloudflarestorage.com"`

The SDK's endpoint is `<account>.r2.cloudflarestorage.com`, but the URL it *signs* is virtual-hosted: `<bucket>.<account>.r2.cloudflarestorage.com`. CSP host matching is exact, so the browser refused to connect. The server-side round trip has no CSP, which is why `verify:storage` passed throughout — and that combination is precisely what made it look like a bucket problem.
**Resolution:** `next.config.ts` now emits both hosts. Listed explicitly rather than as `*.r2.cloudflarestorage.com`, which would also permit every other tenant's bucket on Cloudflare's shared domain.
**Now guarded:** `verify:headers` builds the policy with stand-in account/bucket values and asserts the bucket-scoped host is present — stand-ins because that suite runs credential-free in CI, where the real check would pass by being vacuous. Proven to fail before the fix.
**Lesson:** a truncated error message cost the owner a round trip to a dashboard for a problem that was in this repository. The harness now prints the whole thing.
**Fix (Cloudflare → R2 → bucket → Settings → CORS policy):**
```json
[{
  "AllowedOrigins": ["http://localhost:3000", "https://myaichat-production.up.railway.app"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["content-type"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```
`content-type` is required in `AllowedHeaders`: the client sends it on the PUT because it is part of what was signed, so a policy without it fails the preflight. The policy must be on the **S3 API** bucket endpoint shown in the error, not the public `r2.dev` domain.
**How to confirm:** `npm run verify:upload` — it attaches a file in a real browser, waits for the upload, sends, and asserts against the database that the message stored the attachment. It prints this policy when it detects a CORS refusal.
**Deliberately not in `verify:all`:** it depends on infrastructure outside the repository, and a suite that cannot go green without a dashboard change stops being a signal.

### ISSUE-037 — The layout was tied to one theme

**Status:** Resolved | **Severity:** High | **Phase:** 5 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** Reported by the owner: selecting Rose (or any palette other than Riso) reverted the entire application to the old generic UI — rounded corners, no keylines, no offset shadows, no masthead, a plain list instead of conversation cards. Selecting a theme changed the design, not the colours.
**Cause:** the structure lived in a stylesheet scoped to `[data-theme='riso']`, and the markup that carried it was gated on a server-resolved `riso` boolean. Deliberate at the time, and wrong: it made two designs behind one setting.
**Resolution:** `app/riso.css` → `app/press.css`, unscoped; the `riso` gate removed so every structural element always renders; `--riso-*` colour variables replaced by theme roles. All eight palettes reworked as palettes for THIS layout, with `border` promoted to a true ink held to 3:1 against paper and stock — every dark palette failed that when first measured and was lightened along its own hue.
**Now guarded:** `verify:structure` fails on a theme selector or a colour literal in press.css, then renders all eight palettes in both modes and compares computed borders, radii, shadows, fonts and spacing across seventeen elements. 16 renders, identical.

### ISSUE-036 — Choosing a theme did not choose it

**Status:** Resolved | **Severity:** High | **Phase:** 5 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** Reported as "I select Riso, navigate back to the chat, and it reverts to the default." Read as a persistence failure — and it was not one. Storage, RLS, the server read and the zero-flash render were all correct throughout.
**Cause:** the appearance panel previewed on click and wrote only on a separate **Save appearance** press. Because the preview repaints the entire page, selecting a theme was visually indistinguishable from setting it — so navigating away discarded a choice the user had every reason to believe was already made. Nothing in the interface said otherwise.
**Reproduced:** `verify:persistence` picks Ocean, navigates away without saving, and observed the theme return to the previous value. That is the whole bug.
**Resolution:** every control in the panel now commits on change — a theme is a preference, not a form submission; nothing there is destructive and nothing needs confirming. The Save and Discard buttons are gone; a live status line replaces them, and **Reset to default** stays because it is the one action that is not itself a choice.
**Now guarded:** `verify:persistence` logs in through the real form, selects a theme, then navigates by CLICKING LINKS — never `page.goto`, which is a full reload and would repaint correctly even if client-side navigation lost the theme — through chat → admin → chat → hard reload, comparing the computed `--background`, `--primary`, the `dark` class and the `data-theme` attribute at every step, and screenshotting each.
**Lesson:** "it doesn't persist" was a true description of the experience and a false description of the mechanism. The interface, not the storage, was lying.

### ISSUE-035 — Selecting Riso removed every navigation link

**Status:** Resolved | **Severity:** High | **Phase:** 5 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** Reported by the owner: switching to Riso left the page with no Profile, Appearance, Admin or Sign out, and no way back to settings.
**Cause — two sources of truth for one fact.** Riso hides the shell's navigation bar and expects the chat page's rule bar to carry the replacement. The hide was keyed on the rule bar *existing*; but the rule bar only *carries* navigation when the SERVER rendered it with `riso=true`, while `data-theme` lives in the DOM and the appearance panel's live preview writes to it directly. So `data-theme="riso"` over markup built with `riso=false` hid the header and put nothing in its place.
**Resolution:** the hide is keyed on the replacement itself — `body:has([data-riso='tabs'])`, not `[data-riso='rule']`. No tabs, no hiding, so navigation cannot vanish however the two get out of step. Additionally: the panel now refreshes the route after saving (the theme decides server-rendered structure, not just colour), and reverts an unsaved preview when the page unmounts, so a previewed theme never leaks into pages the server built for a different one.
**Now guarded:** `npm run shoot` forces the mismatch — sets `data-theme="riso"` over a default-theme render — and fails unless Profile, Appearance and Sign out are all still reachable. Reproduced the exact failure before the fix.
**Lesson:** a CSS rule that removes an element on the evidence that its replacement *should* exist is a guess. Key it on the replacement.

### ISSUE-034 — Riso copy doubled wherever the stylesheet did not apply

**Status:** Resolved | **Severity:** High | **Phase:** 5 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** Riso rendered BOTH the plain and the printed wording and hid one with CSS. Any moment `riso.css` did not apply — a dev server that had not picked up a newly `@import`ed file is enough — every label doubled: `myaichatmyaichat`, `New chat Start a page`, `How can I help?A quiet place to think out loud`, `ComposeEnter to send`. Reported by the owner; invisible to all 1,085 assertions and to my own screenshots, because in my environment the stylesheet applied.
**Resolution:** Copy is resolved on the server from the stored preference, so only one variant is ever in the document. `[data-riso-only]` / `[data-riso-hide]` deleted; `verify:riso` fails the build if either returns, and `npm run shoot` fails if both variants render.
**Lesson:** the failure mode of a design should be considered, not just its success. Hiding content with CSS makes the stylesheet load-bearing for correctness, not just appearance.

### ISSUE-033 — Every message was server-rendered invisible

**Status:** Resolved | **Severity:** Medium | **Phase:** 2 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** `MessageEntrance` set `initial={{ opacity: 0 }}` whenever `useMotionSafe()` was true — and `useReducedMotion()` cannot know the preference on the server, so it returned false there. Every message in every conversation was therefore server-rendered at `opacity: 0` and only became visible once JavaScript faded it in; without JS it stayed invisible. In a reduced-motion browser the client disagreed, producing a hydration mismatch on every conversation page.
**Resolution:** the entrance applies only to messages mounted after hydration, tracked with `useSyncExternalStore` (separate server snapshot). Conversations are now visible without JavaScript and hydration agrees.

### ISSUE-032 — A `typeof window` branch in the appearance panel broke hydration

**Status:** Resolved | **Severity:** Medium | **Phase:** 5 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** Introduced by me in PR #37. The "match theme" accent swatch needs to know whether the OS is asking for dark, and read `window.matchMedia` **during render**: the server has no window and rendered the light ink, the browser has one and rendered the dark ink, and React threw *"Hydration failed because the server rendered text didn't match the client"* on `/settings`. The error message's own first bullet is `A server/client branch \`if (typeof window !== 'undefined')\``.
**How it was found:** by opening the page in a real browser. The dev overlay had been showing "1 Issue" on `/settings` and no automated suite noticed — 1,000+ assertions, none of which load a page in something that hydrates.
**Resolution:** the media query moves into state initialised to `false` (matching the server) and corrected in an effect, with a listener for changes while the panel is open.
**Worth keeping:** this class of bug is invisible to every suite in this repo. A headless-browser check is the gap ([ROADMAP](ROADMAP.md)).

### ISSUE-029 — App shell grew past the viewport, so the header and sidebar scrolled away

**Status:** Resolved | **Severity:** Medium | **Phase:** 5 | **Opened:** 2026-08-01 | **Resolved:** 2026-08-01
**Problem:** The `(app)` shell was `min-h-full flex-1 overflow-hidden`. It is meant to be a fixed frame with its own scrollers inside it, but `min-h-full` let it grow to fit its content instead of bounding them, so on any page taller than the window the **document** scrolled: the header and the entire sidebar scrolled up out of view, leaving content beside empty space. Measured on `/settings` at 1440×900 — `document.scrollHeight` 1159 against a 900px viewport.
**The non-obvious half:** the first fix, `h-dvh`, did nothing. `flex-1` sets `flex-basis: 0%`, and in a column flex container the basis IS the height — it silently overrode the explicit height. Both had to go.
**Resolution:** `flex h-dvh overflow-hidden`, no `flex-1`. `dvh` rather than `vh` so the mobile URL bar does not sit over the composer. Verified in a real browser across `/`, `/settings`, `/profile` and `/admin`: no page scroll, no horizontal scroll.

### ISSUE-028 — Refresh-token reuse: refused, but not detected

**Status:** Resolved (with a residual gap, recorded below) | **Severity:** ~~High~~ **Low** | **Phase:** 1 | **Opened:** 2026-07-31 | **Resolved:** 2026-07-31

**Setting:** *Detect and revoke potentially compromised refresh tokens* is
**enabled**, reuse interval **10s** — confirmed by the owner.

---

#### The original finding was overstated, and the fault was in my test

ISSUE-028 claimed a stolen refresh token "stays valid indefinitely". Re-measured
properly, that is **not true**.

The original test used `supabase-js`'s `refreshSession()`. For a token whose
successor already exists, that method **resolves successfully and returns the
successor** — while the auth endpoint itself answers `400`. I read "the promise
resolved" as "the token was accepted", and reported a High-severity hole on that
basis. The SDK was being helpful; the test was not.

Everything below is measured against `POST /auth/v1/token?grant_type=refresh_token`
directly, with no SDK in the way.

#### What actually happens

The realistic scenario — an attacker copies a token, the victim keeps using the
app — measured over three rotations spaced past the reuse interval:

```
attacker copies the token at sign-in: 6hjqj34fkg
  victim rotation 1 (t+12s) → hgl4kd57pe
  victim rotation 2 (t+24s) → 56dwpyjdvo
  victim rotation 3 (t+36s) → pfmxvsuv5j

attacker replays the stolen token, 36s and 3 rotations later:
  HTTP 400  REJECTED: Invalid Refresh Token: Already Used
  victim's current token: HTTP 200 (unaffected)
```

**The stolen token is refused.** The exposure is bounded by the victim's next
rotation, not open-ended.

Within the reuse interval, or while the stolen token is still the immediate
predecessor of the current one, it returns the current successor rather than
erroring. That is deliberate and correct: it stops a client whose refresh
response was lost in flight from being signed out.

#### The residual gap, which is real but small

**Reuse is refused, not *detected*.** A replay returns 400 and nothing else
happens: the family is not revoked, the victim is not signed out, and no record
is written. Across four separate probes, family revocation was never observed
firing.

So a theft is *stopped* but leaves *no trace*. Nobody learns it happened.

**Severity downgraded from High to Low** because the access window is bounded by
one rotation rather than indefinite. It is left open as a note rather than
closed outright, because the detect-and-revoke behaviour the setting names is
not observable from outside, and someone should know that before relying on it.

**Not worth further investigation from here.** Four probes produced inconsistent
intermediate results — a replay was accepted in some orderings and refused in
others — and characterising the exact internal rule is Supabase's business, not
this repository's. What matters for this app is measured and stable: the stolen
token stops working.

#### How it is verified now

`npm run verify:session` runs the threat model above on every invocation:

- **asserts** a stolen token is refused once the victim has rotated past it, and
  that the refusal says *Already Used*
- **warns** that the family survives, rather than failing — a check demanding
  behaviour nobody can produce is a check that stays red for ever
- `-- --strict` promotes that warning to a failure, if the behaviour ever starts
  firing and you want it pinned

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

**Status:** Open — configured everywhere, **delivery needs your inbox** | **Severity:** Medium | **Phase:** 6
**Update 2026-08-02.** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are now in Railway as well as `.env.local`. This is the one Phase 6 item I cannot close myself: I can prove the template renders and the transport is configured, and I cannot prove a message arrived. **One step for you:** sign up on the live site with the address that owns the Resend account, and confirm the welcome mail arrives. It must be that address — `onboarding@resend.dev` is an unverified domain, so Resend delivers only to the account owner.

**Update 2026-07-31.** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are in
`.env.local`; `isEmailConfigured()` returns true, so the transport has switched
from console to Resend.

**No email has been sent or received.** `verify:email` renders the templates and
checks their contrast — it does **not** branch on `isEmailConfigured()` and does
not test delivery, so nothing automated proves a message ever leaves. Check 9 in
the PROGRESS.md resume block closes that half.

**`RESEND_FROM_EMAIL=onboarding@resend.dev`** — an unverified domain. Resend
delivers only to the address that owns the Resend account, so the owner's test
mail will arrive and every real user's will silently not. Correct for now, and
it blocks real signups until a domain is verified.

**Still to do beyond delivery:** the Supabase SMTP setting (checklist B5).
Supabase sends its own confirmation and reset mail through its default SMTP, not
Resend, so until that dashboard change lands users get Supabase's template while
the branded ones sit unused. Cosmetic, not broken — but it is why the two sets
of emails look different.

**Original report below.**

**Status (original):** Open (blocked on credentials) | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-07-31
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

**Status:** Resolved 2026-08-02 | **Severity:** Medium | **Phase:** 6
**Resolved:** Variables added to Railway by the owner, then verified **against production**, not locally: `npm run verify:upload -- --base=https://myaichat-production.up.railway.app` passes 9/9 — paperclip enabled (so `isStorageConfigured()` is true there), presign 200, a real cross-origin PUT to the bucket returning 200, the message stored with its attachment, the model describing the image, and the object read back. Measured timing: presign 945ms, PUT 272ms, composer usable 4.5s after attaching. CSP as served includes both R2 hosts in `connect-src`.

**Update 2026-07-31.** Credentials are in `.env.local` and **proven working**:
`isStorageConfigured()` returns true, and a server-side round trip (presign →
PUT → read back byte-identical → delete → confirm gone) succeeded against the
real bucket. CORS is saved for both origins with the `content-type` header, and
public access is disabled — both confirmed by the owner.

`verify:storage` now takes its configured branch: *"a valid request returns an
upload URL"*, where it previously asserted the 503.

**Still open because no browser upload has ever completed.** The proven round
trip is server-side, which does not exercise CORS at all — the browser PUT is
precisely the untested step. Checks 1–8 in the PROGRESS.md resume block close
this.

**Also outstanding:** the seven variables exist in `.env.local` only. Production
(Railway) does not have them, so uploads stay disabled there. Checklist A4 says
both; Railway was not touched, per the standing rule.

**Original report below.**

**Status (original):** Open (blocked on credentials) | **Severity:** Medium | **Phase:** 6 | **Opened:** 2026-07-31
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
**Re-checked 2026-08-01:** down to **3**, all `sharp`/libvips. The ESLint-chain and `postcss` advisories cleared via upstream patch releases exactly as predicted, without any action here. The remaining three still require `--force`, which downgrades Next.
**Re-checked 2026-08-02 — the line above is now wrong and is corrected rather than edited away.** Still 3 high, but no longer all `sharp`: three *new* `postcss` advisories landed (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849). Measured tree: `next@16.2.12` pins `postcss@8.4.31` and `sharp@0.34.5`; everything else in the tree already resolves `postcss@8.5.25`, which is patched.
**Considered and rejected: a `package.json` override.** Pinning `postcss` to `^8.5.25` and `sharp` to `^0.35` would clear all three without downgrading Next. Not done, because neither has an exposure path here: `postcss` processes only CSS we wrote ourselves at build time, and the advisories need attacker-controlled CSS; `sharp` is reachable only through Next's image optimizer, which no user upload passes through. Overriding a framework's pinned dependency — `sharp` especially, which ships native binaries — trades a real deploy risk for no reduction in actual exposure.
**Resolution:** Left as-is, deliberately. Revisit if either lands on a request path that handles untrusted input, or if Next itself moves off the pinned versions.

### ISSUE-005 — `supabase gen types` needs Docker, so `lib/db/types.ts` is hand-maintained

**Status:** Open — mitigated, drift is now detected automatically | **Severity:** ~~Medium~~ **Low** | **Phase:** 1 | **Opened:** 2026-07-30 | **Resolved:** —
**Problem:** Type generation runs its introspection in a container, so it fails with `LegacyContainerRuntimeNotFoundError` without Docker. `lib/db/types.ts` is therefore written by hand and can silently drift from the migrations.
**Tried 2026-08-01 — the `--db-url` workaround does NOT help.** It fixes `db push` ([ISSUE-020](#issue-020)) but not this: `gen types --db-url` connects to the database and *then* demands a container runtime. Ruled out; do not retry without Docker.
**Mitigated 2026-08-01:** `verify:schema` now compares every column of every table and view against PostgREST's own OpenAPI document — derived from the live database, no container, no new migration, and exactly the schema supabase-js talks to. Both drift directions are reported separately, because they are different bugs: a column the database has and the types do not is invisible to our code; a column the types have and the database does not type-checks perfectly and fails at runtime. Proven to fail in both directions before being committed. 87 columns across 10 relations currently match.
**Remaining:** column *types* are still unchecked — only names. Renaming `text` to `jsonb` would pass. Fully resolved by installing Docker (see ISSUE-004).

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

**Status:** Resolved 2026-08-02 | **Severity:** Medium | **Phase:** 6
**Resolved:** all six variables are in Railway and in `.env.local`. R2 is verified end to end against production ([ISSUE-016](#issue-016)); Resend is configured and its delivery leg is tracked in [ISSUE-017](#issue-017). | **Opened:** 2026-07-30 | **Resolved:** —
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
