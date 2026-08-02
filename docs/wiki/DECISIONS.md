# Decisions

Technical decisions and the reasoning behind them. **Newest entries at the top.**

Log a decision when: choosing a library not named in the spec, making an architecture tradeoff, or deviating from a phase file or the master spec.

Stack choices already fixed by [CLAUDE.md](../../CLAUDE.md) (Next.js, Supabase, Railway, Resend, R2, shadcn/ui) are **not** decisions — they are constraints. Only log a decision if you deviate from them, and say why.

## Entry format

```
### DEC-NNN — Short title
**Date:** YYYY-MM-DD | **Phase:** N | **Status:** Active | Superseded by DEC-NNN
**Decision:** What was chosen.
**Why:** The reasoning, and what was rejected.
**Tradeoff:** What this costs us.
```

---

### DEC-022 — An answer's price is stored, linked, and never inferred

**Date:** 2026-08-02 | **Phase:** 7 | **Status:** Active

**Decision:** `usage_logs.message_id`, nullable, `on delete set null`. Existing rows are not backfilled, and the displayed price is read from the stored `estimated_cost` rather than recomputed from current model rates.

**Why three separate calls, each of which could have gone the other way:**

- **`set null`, not `cascade`.** Deleting a conversation must not erase what it cost. Billing history a user can delete is not billing history — the link is cleared and the record kept.
- **No backfill.** The obvious backfill correlates old usage rows to answers by timestamp. It would be right most of the time and silently wrong the rest, and nothing downstream could tell which. An unpriced answer now renders **no price**, not `$0.00` — a confident zero on an answer that cost real money is worse than saying nothing.
- **Read the stored cost, don't recompute.** A rate change must not retroactively rewrite what last month's answers cost. The row holds the price as charged, which is the only version that stays true.

**Tradeoff:** Answers written before 2026-08-02 will never show a price. The conversation total still counts them as unpriced rather than pretending they were free.

**Boundary note:** `usage_logs` is service-role only, so `loadConversationCost` runs on a client that bypasses RLS and scopes every query to an authenticated user id. That scope is the *entire* authorization boundary for this feature — `verify:costs` asserts it and was confirmed to fail when the scope is removed.

---

### DEC-021 — Overnight P4: build "Ask the presses" and per-message cost

**Date:** 2026-08-02

**Chosen, in order:** (a) *Ask the presses* — one prompt to several models at once, side by side, with per-answer latency, tokens and cost. (b) *Cost transparency* — what each answer and each conversation actually cost.

**Why these two.** They are the only candidates that are **impossible without this app's structure**: four providers behind one abstraction, and per-message token data we already store. Every other candidate is a good chat feature that any chat app could add.

**The gate, answered:**

| | (a) Ask the presses | (b) Cost transparency |
|---|---|---|
| Enabled by our structure? | Yes — one abstraction over four vendors is the whole mechanism | Yes — `messages.input_tokens/output_tokens` already exist per row |
| "That's clever" in 30s? | Two models answering the same question in parallel, with what each cost | Seeing a real number under an answer, and a running month total |
| Testable headlessly? | Yes — NDJSON stream asserted per model, plus Playwright | Yes — arithmetic against stored rows |
| Compromises anything? | Costs N× per run, so it is gated by the same rate limit and daily token budget as chat, and refuses before spending | No |

**Rejected, with reasons:**

- **Conversation branching (c)** — genuinely useful, but nothing about it needs multi-provider or our data. A stranger would call it a good feature, not a clever one, and it needs a schema change plus a tree UI. Highest maintenance cost of the list for the least structural advantage.
- **Full-text search (d)** — Postgres would do the work; the app contributes nothing. Reads as table stakes rather than differentiation.
- **Saved prompts / personas (e)** — settings-shaped. Section 6.7 forbids settings nobody asked for.
- **Smart routing (f)** — the most interesting rejection. It genuinely uses the multi-provider advantage, but "cheap model for simple turns" requires a *classifier* to decide what is simple, and a wrong call silently downgrades an answer the user cared about. Shipping a thing that quietly picks a worse model is worse than not shipping it, and I cannot reach production quality on the judgement layer tonight. Revisit once (a) exists — comparison data is exactly what would justify a routing rule.
- **Model handoff (g)** — already possible: switching model mid-conversation works and is tested. Marking it in the transcript is a small increment on something that exists, not a feature.
- **Printable issue export (h)** — attractive with the press design, and `.md`/`.json` export already exists. Pure presentation; loses to both chosen candidates on the "only this app could do it" test.

**How I will prove they work:** an NDJSON contract test asserting each model streams independently and one failing does not kill the others; a budget test proving a comparison is refused *before* spending when the daily limit would be exceeded; usage rows written per model so analytics stay accurate; Playwright screenshots at 1440px and 360px.

**The strongest argument against (a):** it multiplies spend by the number of models selected, on an app whose own README makes a point of cost control. Chosen anyway because the spend is explicit, bounded by the existing budget, refused up front rather than mid-run, and *visible in the result itself* — the feature's output is what it cost. A cost-control story is better served by a feature that shows costs than by not building it.

**Outcome:** both shipped and merged — (a) PR #48, (b) PR #49. Mechanics of (b) are [DEC-022](#dec-022).

---

### DEC-020 — Every palette gets two inks and its own stock

**Date:** 2026-08-01

**Decision:** the palette set is seven presses, not seven hues: Riso, Newsprint, Blueprint, Pulp, Neon, Botanical, Mono. Each has a **stock** of its own — grey, deep blue, tan, near-black, cream, pure white — and **two contrasting inks**, not one accent on near-white.

**Why:** the previous set was eight near-white backgrounds with one mid-tone accent each. Structurally identical *and* perceptually identical, which made the picker a list of tints. Riso was the only one with character, and the only one using two inks.

**A sixth role was added** — `display`, the second ink at large type — because the ink that works as a filled chip is often unusable as text. Riso's yellow pill cannot be a headline; Mono has no second ink at all and repeats its first, deliberately.

**Two measurement lessons, both learned by getting it wrong:**

- **`mix-blend-mode: multiply` is not an overprint, it is a subtraction.** It leaves the backdrop untouched wherever the ink is lighter than the stock, so on Blueprint's deep blue paper the marked headline words vanished completely. Removed; the second ink is now set as a plain colour.
- **Contrast ratio is the wrong metric for "are these two inks different".** It compares luminance, so it scored Neon's electric green against its magenta at **1.04:1** — two colours that could not look less alike, rated nearly identical. Ink separation is measured as distance in RGB (≥60) instead. Using contrast ratio would have forced the palettes to be dull in order to pass.

**Retired ids are migrated, not dropped:** `default → newsprint`, `midnight/ocean → blueprint`, `forest → botanical`, `sunset/rose → pulp`. A row pointing at a palette that no longer exists is a broken row, so this migration does touch existing preferences — the only theme migration that does, and it says so.

---

### DEC-019 — The layout is permanent; a theme is colour and nothing else

**Date:** 2026-08-01 · **Supersedes the containment half of [DEC-017](#dec-017)**

**Decision:** the print layout — masthead, ink keylines, offset shadows, zero radius, conversation cards, mono section rules, numbered picks, the boxed COMPOSE panel — is the application's only layout, for every palette and every page. A palette answers five questions and no others: paper, ink, first accent, second accent, muted.

**Why the previous arrangement was wrong:** the structure was scoped to `[data-theme='riso']`, so selecting Rose did not render the newspaper in rose inks — it swapped the newspaper for a different application. Two designs behind one setting is not a theme system; it is a fork with a dropdown.

**How it is enforced.** `app/press.css` may not name a theme or a colour: `verify:structure` fails the build on a `[data-theme=…]` selector or a hex literal, then loads all eight palettes in both modes and compares computed border widths, radii, shadows, fonts, spacing and display across seventeen structural elements. Sixteen renders, all identical.

**Two token roles were added**, because the design needs them and every palette must therefore answer for them:
- `accentAlt` — the second plate, used once, on the model pill. A press sheet with one ink is a memo.
- `overprint` — where the two inks overlap: the selected conversation card, which is overprinted rather than tinted.

**And one existing token changed meaning.** `border` is now the ink: it draws 2px rules and solid offset shadows, so it is held to **3:1 against both paper and stock** (WCAG 1.4.11's bar for a meaningful non-text element). Every dark palette failed that when first measured — the borders were subtle in the way a soft-UI theme wants and a printed one cannot afford — and each was lightened along its own hue until it cleared.

**Cost:** eight palettes now have to be designed, not just picked. A colour that looks pleasant as a hairline may be unusable as a keyline, and the check will say so.

---

### DEC-018 — The fluorescent pink is kept as a fill and darkened only as text

**Date:** 2026-08-01

**Decision:** Riso's Fluorescent Pink exists as three tokens, not one:

| token | value | where |
| --- | --- | --- |
| `--riso-pink` | `#ff48b0` | fills — the action button, rules, borders |
| `--riso-pink-display` | `#ed43a4` | large text, 3.04:1 |
| `--riso-pink-text` | `#bd3582` | normal text, 4.52:1 |

**Why:** a background carries no contrast obligation; text does. Darkening every pink to satisfy the strictest case would have dulled the one colour the theme is named for in order to meet a rule that does not apply to most of the places it appears. The darkening for large text is 7% — visually indistinguishable from the mockup's ink.

The mockup sets paper-coloured text on the pink action at **2.65:1**. That could not ship, so the ink is kept and the text on it is dark instead (5.14:1). The button still reads as fluorescent pink, because it is.

**Enforced:** `verify:riso` reads all three from the stylesheet rather than restating them, and asserts the FILL is exactly `#ff48b0` — because the easy way to make the contrast checks pass is to darken everything, which would silently replace the theme's defining colour.

---

### DEC-017 — Riso is a design system, contained by a parse rather than by care

> **Superseded 2026-08-01 by [DEC-019](#dec-019).** The containment was the
> mistake: scoping the structure to one theme meant the other seven kept a
> different design. The *technique* survives — a parse, not care — but it now
> proves the opposite property: that no theme can change the structure.

**Date:** 2026-08-01

**Decision:** The Riso look lives in `app/riso.css`, and **every selector in that file begins with `html[data-theme='riso']`**. `npm run verify:riso` parses the stylesheet and fails the build on any rule that does not — including an unscoped second entry in a comma-separated list, which is the case a human reviewer misses.

**Why:** Riso is the only theme that is not a palette. It restyles the sidebar, the empty state, the composer and every card, so the usual guarantee — "themes are just eight tokens, they cannot break each other" — no longer holds for it. Something had to replace that guarantee, and a reviewer's attention is not it.

**Consequences:**
- Riso-only markup (`[data-riso-only]`) is rendered on **every** theme and hidden by a single rule in globals.css. That rule cannot live in `riso.css`, because by definition it must apply when Riso is *not* active.
- Switching themes stays a pure CSS change with no re-render, which is what keeps the appearance panel's live preview honest. Conditionally rendering the chrome per theme would have broken that.
- `@keyframes` names are global regardless of what they animate, so they are namespaced `riso-` by hand and checked.
- Colours the stylesheet introduces itself — the yellow ticket, the pink action — never pass through `presets.ts`, so `verify:theme` cannot see them. `verify:riso` checks their contrast instead.

**Cost, stated plainly:** the components now carry presentational hooks for one theme. That is a real smell. It is accepted because the alternative — a second set of components behind a theme check — duplicates every chat surface and guarantees they drift.

**Amended 2026-08-01 — copy is resolved on the server, not hidden with CSS.** The first version rendered both the plain and the printed wording and hid one with a stylesheet. When that stylesheet did not apply, every label doubled: `myaichatmyaichat`, `New chat Start a page`, `ComposeEnter to send`. A theme that degrades into duplicated words is worse than one that degrades into plain words. Only one variant is now ever in the document, and `verify:riso` fails if the `[data-riso-only]` pattern returns.

**Amended 2026-08-01 — one top bar, via `:has()`.** The mockup gives the page a single bar; the app stacks two, because navigation lives in the layout and the model selector's state lives in the thread. Rather than lift that state, the navigation comes down into the rule bar and the shell's bar is hidden on any page that renders a rule to replace it:

```css
html[data-theme='riso'] body:has([data-riso='rule']) [data-riso='masthead-bar'] { display: none }
```

It resolves at first paint with no JavaScript, and it cannot hide the bar on settings, profile or admin — those render no rule and keep theirs. Where `:has()` is unsupported the page shows two bars, both fully functional, which is the right way for this to fail.

### DEC-NNN — Short title
**Date:** YYYY-MM-DD | **Phase:** N | **Status:** Active | Superseded by DEC-NNN
**Decision:** What was chosen.
**Why:** The reasoning, and what was rejected.
**Tradeoff:** What this costs us.
```

---

### DEC-016 — Branch protection binds administrators, and requires a PR but no approval

**Date:** 2026-07-31 | **Phase:** 8 | **Status:** Active
**Decision:** `main` requires a pull request with both blocking CI jobs green.
Approvals required: **0**. `enforce_admins`: **true**.

**This reverses the recommendation I wrote in ISSUE-018 two hours earlier**,
which suggested `enforce_admins: false` to avoid a solo maintainer locking
themselves out of a 2am hotfix. That reasoning was wrong for this repository:
you are the only person who pushes to it, so exempting administrators exempts
*everyone*, and the protection becomes a decoration that reports rather than
enforces. A rule that binds nobody is not a rule.

**Why 0 approvals rather than 1.** Requiring an approving review on a
single-maintainer project means nothing can ever merge — GitHub does not let you
approve your own pull request. `0` still forces the pull request, which is where
the value is: CI must pass, the branch must be up to date, and the change is
visible as a diff before it lands.

**Argument against, stated plainly.** You can no longer push a one-line fix
directly, even when you are certain and in a hurry. Every change now costs a
branch, a push, a PR, and roughly ninety seconds of CI. On a project with one
maintainer and no reviewer, some of that ceremony buys nothing.

**Why I chose it anyway.** The failure it prevents is not a bad *decision*, it is
a bad *accident* — a stray `git push` from the wrong branch, a rebase that goes
sideways, a force push that eats history. Those happen when you are tired and
certain, which is exactly when the exemption would have been used. And the
escape hatch is genuinely one command (`gh api --method DELETE …
branches/main/protection`), so the cost of being wrong about this is a minute,
while the cost of being wrong the other way is production.

**Configuration, for re-applying after any deliberate bypass:**

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint, type-check, build", "Tests (credential-free)"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
```

**Consequence for how work happens here:** every future change — including
agent-driven sessions — goes `git checkout -b`, push the branch, open a PR, wait
for CI, merge. The instruction "commit per feature, push when green" now means
"one PR per feature".

### DEC-015 — CSP keeps `'unsafe-inline'` for scripts; the trade is accepted and closed

**Date:** 2026-07-31 | **Phase:** 7/8 | **Status:** Active — **owner decision, not revisitable by an agent**
**Decision:** `script-src` keeps `'unsafe-inline'` in production. The pre-paint theme resolver in `app/layout.tsx` stays an inline script.
**Why:** The alternative is a nonce, and a nonce cannot be applied to that script without reintroducing the flash of wrong theme that Phase 5 exists to eliminate. The other route — moving theme resolution to a cookie read in `proxy.ts` — is real work on the one part of the stack where a mistake logs everybody out. Weighed against the actual exposure, it is not worth it: every rendered surface is React-escaped, Markdown is sanitised, and there is no path that injects attacker-controlled markup into a page.
**Argument against, stated plainly:** `'unsafe-inline'` removes CSP's usefulness as a *second* line of defence against XSS. If a sanitiser bug ever shipped, the CSP would not catch it. That is the cost being accepted.
**Consequences:** `verify:headers` reports the exception as a note rather than a failure, so it stays visible in every run without going red. `'unsafe-eval'` is a separate matter — allowed in development only (ISSUE-021), never in production, and asserted as such.

### DEC-014 — Signup password rules follow NIST, and apply to signup only

**Date:** 2026-07-31 | **Phase:** 8 (Session 2) | **Status:** Active
**Decision:** Signup requires 10+ characters and rejects a blocklist of common, repetitive and email-derived passwords. It does **not** require mixed case, digits or symbols. The login path keeps the original 8-character minimum.
**Why:** NIST SP 800-63B dropped composition rules because they reliably produce `Password1!` — a stricter-*feeling* rule that concentrates users into a small, well-known region of the keyspace. Length plus a blocklist of what attackers actually try is the current guidance.
**The split matters more than the rules.** Raising the minimum on the *login* schema would reject every existing account whose password is 8 or 9 characters, at form validation, before the password is ever checked — the user would be locked out of their own account with no path to fix it. Existing users move to the new rules through a password reset, not a wall.
**Tradeoff:** Two schemas to keep straight instead of one, and the blocklist is a hand-written ~50 entries rather than a breach corpus. A k-anonymity range query against Have I Been Pwned would be strictly better and is the upgrade path — it was not taken tonight because it puts a third-party HTTP call in the signup path.

### DEC-013 — Login throttling stores attempts in Postgres, not memory

**Date:** 2026-07-31 | **Phase:** 8 (Session 2) | **Status:** Active
**Decision:** Failed password attempts are counted in a new `auth_attempts` table (deny-all RLS, service-role only), keyed by an HMAC of the email and separately by an HMAC of the client IP. Five failures per account or thirty per IP in fifteen minutes blocks further attempts.
**Why:** A module-level `Map` is the obvious implementation and is worth almost nothing: it resets on every deploy and is not shared between instances, so the lockout lasts exactly as long as an attacker is unwilling to wait for a restart. Two counters rather than one because they catch different attacks — a per-account counter never trips under password spraying (one attempt per account), and a per-IP counter alone punishes shared networks.
**Identifiers are hashed** so the table cannot be harvested as a list of registered email addresses if it is ever exposed.
**Tradeoff:** One indexed query per login attempt, and the IP counter is only as trustworthy as `x-forwarded-for` — spoofable without a trusted proxy in front. That is why the IP limit is the loose one and the per-account limit carries the weight.

### DEC-012 — Provider key changes require the password again, enforced server-side

**Date:** 2026-07-31 | **Phase:** 8 (Session 2) | **Status:** Active
**Decision:** `setProviderKey` and `deleteProviderKey` call `requireAdminWithPassword()`, which re-verifies the admin's password on a throwaway Supabase client (`persistSession: false`) and is itself throttled under a separate `reauth` counter.
**Why:** A stolen session cookie or an unlocked laptop gives an attacker everything the session can do, including replacing the provider key with their own and billing the real account. Re-asking for the password is the one control that a session alone cannot satisfy. It runs in the Server Action, not the dialog — a check enforced only in the component that calls the action is not enforced at all, since the action is a POST endpoint.
**Two details:** the check uses a throwaway client because calling `signInWithPassword` on the request-bound client would silently re-issue the session cookies as a side effect of a confirmation; and it is throttled because an unthrottled "confirm your password" field is a password oracle that already knows which account it is asking about.
**Tradeoff:** Two extra fields in the admin UI, and re-auth failures must be *returned* rather than thrown — Next replaces thrown Server Action errors with a generic message in production, which would render "that password is not correct" as "an error occurred".

### DEC-013 — Admin mutations are Server Actions, not route handlers

**Date:** 2026-07-30 | **Phase:** 4 | **Status:** Active
**Decision:** Every admin mutation is a Next.js Server Action in `app/(app)/admin/actions.ts`. There is no admin REST endpoint.
**Why:** The phase file requires CSRF protection on admin mutations. Server Actions verify the `Origin` header against the host before the action body runs, so CSRF is handled by the framework rather than by a token scheme we would have to implement, rotate, and get right. A route handler would need that scheme built from scratch.
**Enforcement:** `verify:admin` greps the actions file and asserts every exported function calls `requireAdmin()` and every mutating one calls `auditLog()`. A route-level test alone would miss an action that forgot the gate.
**Tradeoff:** No admin API for external scripts. If one is ever needed it must carry its own CSRF and auth, and cannot simply reuse these functions.

### DEC-012 — Suspension is enforced in RLS, not only in the route

**Date:** 2026-07-30 | **Phase:** 4 | **Status:** Active
**Decision:** `profiles.suspended` gates writes through row-level security (`is_suspended()` in migration `20260730120005`), in addition to the 403 returned by `/api/chat`.
**Why:** A check that lives only in one route handler is one forgotten call site away from being useless — and Phase 6 adds uploads, Phase 7 adds more endpoints. Putting it in the database means every current and future write path inherits it.
**Detail:** suspension blocks writes but not reads. A suspended user keeps their history and can sign in; they just cannot add to it. Deleting their data would be a different, much more destructive decision.
**Note:** `suspended` is not in the master spec's schema, which lists only `role` on `profiles` — but the spec's own feature list asks for suspend/activate, so the column is required to build what was specified.

### DEC-011 — `validateKey()` must spend a token, never just list models

**Date:** 2026-07-30 | **Phase:** 3 | **Status:** Active
**Decision:** Every adapter's `validateKey()` performs a real (tiny) generation. Listing models is explicitly not acceptable as a validation check.
**Why:** An unfunded key authenticates perfectly and lists models happily — it fails only when asked to do work. The first OpenAI key supplied for this project did exactly that: HTTP 200 on `/v1/models`, `insufficient_quota` on every completion. A models-list check would have reported it healthy and Phase 4's "Test Connection" button would have lied to the admin.
**Tradeoff:** Validation costs a fraction of a cent and a round trip. Worth it — the alternative is a green tick on a key that cannot work.
**Gotcha:** the probe needs a real token budget. OpenAI raises `invalid_request_error` when `max_completion_tokens` can't fit a whole message, so a 1-token probe fails on a healthy key; Anthropic truncates instead. The OpenAI probe uses 16.

### DEC-010 — Provider marks are lettermark badges, not vendor logos

**Date:** 2026-07-30 | **Phase:** 3 | **Status:** Active
**Decision:** The model selector shows a coloured lettermark per provider rather than the vendors' actual logos.
**Why:** The phase file asks for "provider logos", but reproducing a trademark from memory ships a wrong approximation of someone else's brand. A neutral badge is honest and swappable.
**Tradeoff:** Less polished than real logos. `components/chat/provider-logo.tsx` is the single swap point if official assets are obtained — and an unknown provider degrades to its initial automatically, so new providers need no artwork.

### DEC-009 — Chat streams as newline-delimited JSON, not SSE

**Date:** 2026-07-30 | **Phase:** 2 | **Status:** Active
**Decision:** `/api/chat` returns `application/x-ndjson` — one JSON event per line (`text`, `done`, `error`) — read with a plain `fetch` reader.
**Why:** The endpoint is a POST carrying conversation state, and `EventSource` only issues GETs, so SSE would have meant a side-channel to pass the body. NDJSON needs no client library and no framing rules beyond splitting on newlines.
**Tradeoff:** No automatic reconnect (SSE gives that free). Irrelevant here — a dropped chat stream should surface an error and let the user retry, not silently resume mid-sentence.

### DEC-008 — Extended thinking is off for chat

**Date:** 2026-07-30 | **Phase:** 2 | **Status:** Active
**Decision:** The Anthropic adapter sends `thinking: {type: 'disabled'}` with `claude-opus-5`. Thinking is **on by default** on that model, so this is an explicit opt-out, not the default.
**Why:** Interactive chat is judged on time-to-first-token. Thinking delays the first visible character and bills tokens the user never sees. Phase 5/7 can expose it as a per-model toggle once there's UI to display reasoning.
**Consequences to carry forward:**

- Disabling thinking is only valid at `effort` **high or below** — pairing it with `xhigh`/`max` is a 400. The default effort is `high`, so the current call is valid; raising effort later means re-enabling thinking.
- With thinking off, Opus 5 can leak internal XML into the visible response. The documented mitigation is a **generic** "do not include internal or system XML tags" instruction — and explicitly **not** an instruction telling the model not to reason, which makes leakage worse. That wording is in `lib/providers/anthropic.ts`; don't "improve" it into a don't-think rule.

**Source:** https://platform.claude.com/docs/en/about-claude/models/migration-guide
**Tradeoff:** Lower answer quality on hard reasoning prompts than thinking-on would give.

### DEC-007 — Provider order follows the phase file; OpenAI waits for Phase 3

**Date:** 2026-07-30 | **Phase:** 2 | **Status:** Active
**Decision:** Phase 2 is built against **Anthropic**, as its phase file specifies, even though an OpenAI key was available first. OpenAI becomes the second provider in Phase 3, with `gpt-5.4-mini` as its default model.
**Why:** The master spec only says "one provider" for Phase 2, so the order was genuinely arbitrary and swapping would have cost nothing structurally. Keeping the phase file authoritative was chosen over convenience — Phase 3 needs both providers regardless, so nothing is lost, and the phase files stay trustworthy as written.
**Tradeoff:** Phase 2 is blocked until an Anthropic key exists ([ISSUE-010](ISSUES.md)), despite a working OpenAI key sitting in `.env.local`.

### DEC-006 — Route protection is layered, not delegated to middleware

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** `proxy.ts` redirects unauthenticated requests, but every protected page also calls `requireUser()` / `requireAdmin()` server-side. Both use `getUser()`, never `getSession()`.
**Why:** Middleware is a convenience gate — it can be bypassed in some deployment topologies, and it runs before the page decides anything. `getSession()` only decodes the cookie without verifying it against the Auth server, so it is not safe for authorization. RLS is the final backstop underneath both.
**Tradeoff:** One extra auth round-trip per protected render. Worth it; `verify:gates` covers the non-admin `/admin` path explicitly.

### DEC-005 — Provider secrets protected by column-level grants, not RLS

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** `SELECT` on `public.providers` is revoked from `authenticated`, then re-granted on `(id, name, enabled, created_at, updated_at)` only. A `providers_public` view (`security_invoker = true`) gives clients a `select *` they can actually use.
**Why:** The spec asks for providers to be "readable (non-secret columns) by authenticated users." RLS is **row**-level and cannot hide a **column**, so no policy can protect `encrypted_api_key` — a column grant is the only mechanism that does. This is a deviation in mechanism, not intent.
**Tradeoff:** `select *` on the base table now errors for normal users, which is surprising until you know why. The view exists to absorb that. `verify:rls` asserts both the block and the view.

### DEC-004 — Migrations run against the hosted database; no local Supabase stack

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** The Supabase CLI is installed as an npm devDependency and linked to project `uorgodndubyznjzotzje`. Migrations apply with `supabase db push`. No Docker, no local stack.
**Why:** Docker Desktop is not installed and the local stack is the only thing that needs it. Remote-only gets Phase 1 moving today with no extra tooling.
**Tradeoff:** Every migration test hits the real cloud database, and `supabase db reset --linked` would destroy it rather than a throwaway local copy. Acceptable while the project is empty. Revisit — install Docker and move to a local stack — before the database holds data worth keeping. Tracked as [ISSUE-004](ISSUES.md).

### DEC-003 — Supabase's new API key format (`sb_publishable_` / `sb_secret_`)

**Date:** 2026-07-30 | **Phase:** 1 | **Status:** Active
**Decision:** This project uses Supabase's new API keys, **not** the legacy `anon` / `service_role` JWTs. All Supabase client code must be written for that format.
**Why:** The keys issued for this project are already new-format. Legacy JWT keys are deprecated and scheduled for removal by end of 2026, so building against them would mean a forced migration later.
**Rules that follow — these bind all future phases:**

- The keys are **opaque strings, not JWTs**. Never decode, parse, or inspect claims from a key. Anything that expects to read `role` out of the key will fail.
- They cannot be sent as `Authorization: Bearer`. They belong in the `apikey` header — `supabase-js` and `@supabase/ssr` handle this, so use the SDK rather than hand-rolled `fetch`.
- `sb_publishable_` is the browser-safe key (replaces `anon`); `sb_secret_` is server-only (replaces `service_role`) and **still bypasses RLS** via the `service_role` Postgres role.
- Supabase Edge Functions only verify legacy JWTs, so any Edge Function must be deployed with `--no-verify-jwt` and do its own auth check.
- Env var **names** stay legacy-styled (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) while holding new-format **values**. Intentional, so it doesn't read as a mistake.

**Source:** https://supabase.com/docs/guides/api/api-keys
**Tradeoff:** Some third-party tutorials and older libraries still assume JWT keys and will need adapting.

### DEC-002 — Wiki lives in the repo, not an external tracker

**Date:** 2026-07-30 | **Phase:** 0 | **Status:** Active
**Decision:** Project state is tracked in `docs/wiki/` as Markdown, versioned alongside the code.
**Why:** State stays in sync with the commit that changed it and is readable at the start of every session without network access or a separate tool. An external tracker (GitHub Issues, Notion) would drift from the code and be invisible to a fresh session.
**Tradeoff:** No issue assignment, notifications, or cross-linking to PRs. Acceptable for a single-maintainer build; revisit if the project takes on collaborators.

### DEC-001 — Docs restructured to match the paths CLAUDE.md declares

**Date:** 2026-07-30 | **Phase:** 0 | **Status:** Active
**Decision:** Moved `CLAUDE.md` to the repo root, the master spec to `docs/00-PROJECT-SPEC.md`, and the eight phase files to `docs/phases/`. The original `Phases Files/files/` directory was removed.
**Why:** CLAUDE.md already referenced `@docs/00-PROJECT-SPEC.md` and `docs/phases/`, so both references were broken as delivered. CLAUDE.md is also only auto-loaded into a session when it sits at the repo root.
**Tradeoff:** None — no code referenced the old paths.
