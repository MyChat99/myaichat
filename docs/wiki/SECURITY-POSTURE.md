# Security posture — spend and access

What stands between a public link and the owner's card, and what each control
actually guarantees. Written 2026-08-03, when the monthly ceiling and the signup
policy were added.

The distinction that matters throughout: a **guarantee** is something a test
asserts and a break-test has been seen to catch. Everything else is a
description of intent, and is labelled as such.

---

## The controls, and what each one answers

| Control | Question it answers | Setting | Default when unset |
| --- | --- | --- | --- |
| Hourly message limit | How *often* can one person ask? | `rate_limit_messages_per_hour` | 60 |
| Daily token budget | How much can *one person* spend in a day? | `daily_token_budget_per_user` | **unlimited** |
| **Monthly spend ceiling** | How much can **everybody** spend in a month? | `monthly_spend_ceiling_usd` | **$25 — fails closed** |
| Signup policy | Who may create an account at all? | `signups_enabled`, `signup_allowed_domains` | open |
| Endpoint limits | How often can uploads be requested? | per-endpoint, in `api_usage` | built in |

They are not interchangeable, and the reason is arithmetic: sixty messages an
hour of 100k-token context is a bill the message counter never sees, and ten
users inside their individual daily budgets are still ten times the bill.

---

## The one control that fails closed

Every other limit here treats a missing setting as "unlimited", so upgrading a
deployment never starts refusing requests mid-use. **The monthly ceiling does
not.** A deployment that has never configured it gets $25, not infinity.

The reason is that the failure modes are not symmetrical. An over-tight limit
inconveniences someone for as long as it takes an admin to raise it. An absent
ceiling on a public URL is unbounded spend on one person's card, at a stranger's
schedule, discovered when the bill arrives.

Setting `0` explicitly still means unlimited. Turning a safety limit off should
be possible; it should just require someone to say so.

**Guaranteed** (`verify:spend`, and each break-tested):

- an unconfigured deployment gets a real ceiling, not infinity
- an admin can still disable it deliberately with `0`
- a message past the ceiling is refused with 429, **and writes no usage row** —
  proven by disabling the gate, at which point the message succeeds and a usage
  row appears (`0 → 1`)
- `/api/compare`, which spends N times a single turn, is behind the same ceiling

**Not guaranteed — an honest limit.** The ceiling is a ceiling, not a meter.
Usage rows are written when a response *finishes*, so requests already in flight
when the line is crossed will complete. It stops a runaway; it does not bill to
the cent. Making it exact would need a reservation row per request and a
compensating delete on failure.

---

## Who may create an account

Three modes, from two settings, so no migration was needed and the existing
switch keeps its meaning:

| Mode | `signups_enabled` | `signup_allowed_domains` |
| --- | --- | --- |
| Open — anyone with the link | true | empty |
| Restricted to listed domains | true | `example.com, university.ac.uk` |
| Closed — admin creates accounts | false | — |

**A gap that was live until 2026-08-03.** The admin panel had carried an "Allow
new signups" switch since Phase 4, and the sign-up action **never read it**.
Turning signups off left them on. That is worse than having no switch: it is the
control someone would rely on before sharing the link. It is now enforced in the
sign-up action, and `verify:spend` drives the real form in a browser to prove it
— a helper nobody calls is not enforcement.

**Guaranteed:** with signups closed, the form refuses, the browser is not signed
in, and no account row is created. A listed domain is admitted; a lookalike
domain (`notexample.com` against `example.com`) is not.

**Deliberately not built yet:** invite *codes*. "Closed" is the invite-only
equivalent today — the admin creates the account. Codes mean a table, an admin
screen to issue and revoke, and an email; that is a separate piece of work, and
claiming invite-only without it would be a claim the app cannot honour.

---

## Two corrections to an earlier audit of this file's subject matter

Both were reported by the owner from the Railway console, which this project
does not read:

- **There is no provider env-key fallback on this deployment.** No
  `ANTHROPIC_/OPENAI_/GROQ_/PERPLEXITY_API_KEY` variables are set, so
  admin-panel keys are already the only spend source. The code path exists and
  is documented in [ISSUE-062](ISSUES.md#issue-062); it is dormant here.
- **`RESEND_API_KEY` is set**, so the console-transport fallback is *not* what
  is happening to email. Delivery is most likely blocked by an unverified
  sending domain — which fails silently at the recipient while succeeding at
  every layer this app can observe ([ISSUE-060](ISSUES.md#issue-060)).

## What is still open

- **The per-user daily budget is unlimited on this deployment** (`0`). The
  monthly ceiling is the backstop, which is why it fails closed. Setting a
  per-user figure is a decision for the owner, and the admin Settings page now
  says so rather than leaving `0` to be read as "fine".
- **Provider spend is not a free tier.** Everything else this app runs on has a
  free allowance; the model APIs are real money. See
  [FREE-TIER-OPERATIONS.md](FREE-TIER-OPERATIONS.md).
- **Moderation is not implemented** ([ISSUE-055](ISSUES.md#issue-055)). Nothing
  inspects message content before a provider call.

---

## Where to look

| | |
| --- | --- |
| Ceiling logic | `lib/security/spend-ceiling.ts` |
| Signup policy | `lib/security/signup-policy.ts` |
| Daily budget | `lib/security/token-budget.ts` |
| Hourly limit | `lib/security/rate-limit.ts` |
| Tests | `npm run verify:spend` |
| Live figures | `/admin` — spend against the ceiling, and the current signup mode |
