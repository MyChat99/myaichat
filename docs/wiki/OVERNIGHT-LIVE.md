# Overnight session — live report

Updated after every merged PR. If I stopped at any moment, this is complete and
current as of the last entry.

**Started:** 2026-08-02 · `main` @ `c928504` · suite green, 25 suites / 1,176
assertions · Playwright verified working (screenshot taken before any work).

---

## § WHAT YOU CAN NOW DO THAT YOU COULDN'T LAST NIGHT

- **Pick a model and know it will work.** Groq and Perplexity were seeded with
  no keys, so the chat offered all 11 of their models and the empty state
  claimed "11 models are inked and ready" — choosing one failed only after you
  had typed a message and pressed send. The picker now offers the 4 models that
  can actually answer. → `docs/screenshots/providers/model-picker.png`
- **Ask the presses.** New page in the top bar. Pick two to four models, write
  one prompt, and every model answers at once in its own column — with what that
  answer cost, its token counts, and how long it took to say its first word. A
  summary underneath names the cheapest and the first to answer. This is the one
  thing in the app that no single-vendor chat product can copy.
  → `docs/screenshots/compare/desktop-result.png`, `mobile-result.png`
- **See what an answer cost you.** Every reply now carries its price, and the
  masthead runs a total — this conversation, and this month to date. The app was
  already recording every token and every dollar and showing you none of it:
  spend lived on an admin dashboard, in aggregate, which the person spending the
  money cannot open. → `docs/screenshots/cost/thread-light.png`, `thread-dark.png`
- **Use the app on a phone.** At 360px, Presses, Profile, Appearance, Admin and
  Sign out were all past the right edge of the screen — not scrolled off,
  *clipped and gone*, because the chat pane clips with `overflow: hidden`. There
  was no scrollbar to suggest they existed. You could not open settings or sign
  out from a phone at all; at 768px it cost Admin and Sign out. The band now
  wraps and every control is reachable.
  → `docs/screenshots/mobile-nav/before-360.png` vs `after-360.png`
- **See one design instead of two on the sign-in page.** Its card was square
  with a hard offset shadow and its fields and button were rounded, because
  shadcn writes `rounded-lg` as a literal class where `--radius: 0` cannot reach
  it. Fixed for those primitives everywhere they appear.
  → `docs/screenshots/login/before-360.png` vs `after-360.png`
- **Be told what to do when you are suspended.** The banner said you could read
  but not send. It now also says who to ask to have it lifted.
- **Send a message with a stale attachment and get told what to do**, instead of
  a blank failure. An attachment whose file is no longer in storage used to
  return a 500 with a vendor stack in the server log; it now says
  *"holiday.png could not be read from storage. Remove it and attach it again."*

---

## § WHAT I NEED FROM YOU

Ordered. Everything here is blocked on something only you can reach.

1. **Add the R2 and Resend variables in Railway.** Uploads, avatars and email
   are built, tested locally end-to-end, and disabled in production purely
   because the credentials are not there. The seven names are in
   `PHASE-6-CHECKLIST.md` A4. Expected result afterwards: the paperclip in the
   composer is enabled on the live site, and `npm run verify:upload -- --base=https://myaichat-production.up.railway.app`
   passes.
2. **Nothing else is blocking.** Everything below in EVERYTHING ELSE was
   completed without you.

---

## § EVERYTHING ELSE

### Cycle log

| # | Work | Value gate | Outcome | Class |
|---|---|---|---|---|
| 0 | Pre-flight: merged PR #46, baselined suite, verified Playwright | — | 25 suites green, 1,176 assertions | — |
| 2 | **Ask the presses** — one prompt to up to four models, side by side, with cost, tokens and time-to-first-token | Helps you (demo) and any visitor: they can see four vendors answer the same question and what each cost, which needs the abstraction and our per-message token data | Merged | USER-VISIBLE |
| 1 | Unconfigured providers offered models that could not answer; missing attachment returned 500 | Helps anyone on the live site: they stop being offered models that fail on send, and a stale attachment tells them what to do | Merged | CORRECTNESS |
| 3 | **Cost transparency** — what each answer and each conversation cost, plus a running month total | Helps you and every user: the app charged for tokens and showed the number only to admins. Needs our per-message token rows, which a wrapper around one vendor's API does not have | Merged (PR #49) | USER-VISIBLE |
| 4 | The mobile nav was unreachable; `verify:pages` renders every route at 360/768/1440 | Helps anyone who opens this on a phone — they could not sign out or reach settings | Merged (PR #51) | CORRECTNESS |
| 5 | `/login` and `/signup` had never been rendered by any suite; the sign-in page mixed square and round | Helps every visitor: it is the first page anyone sees, and it did not look like the product | Merged (PR #52) | USER-VISIBLE |
| 6 | `verify:failures` induces six real failures in a browser and reads what the screen says | Helps anyone who hits a limit or an outage: they now get a message that says what happened and what to do | Merged (PR #53) | CORRECTNESS |

### Detail

**Cycle 1 — a provider without a key must not offer models.** Registering an
adapter and seeding its catalogue is not the same as having paid for the
service. `listAvailableModels()` filtered on `enabled` and "an adapter exists",
neither of which implies a usable credential. Now filtered on key presence too,
using `key_last4` — written and cleared with the key itself, so it is an exact
test that never pulls ciphertext into memory. The env-var fallback still counts,
because a fresh checkout with keys in `.env.local` is a supported way to run
this.

Two assertions added to `verify:providers`: every offered model comes from a
provider that holds a key, and a registered-but-unconfigured provider offers
nothing. It reports which ones are correctly hidden, so the check cannot pass by
there being nothing to hide.

**The fix exposed a second, unrelated bug.** With unconfigured models no longer
resolving, `verify:storage` fell through to a different model and hit a path
nothing had reached before: an attachment whose object is missing from the
bucket threw out of `fetchObject` and surfaced as a bare **500**, with a vendor
stack in the log and the storage path — which contains the owner's user id — in
the server error. Reachable in real use by an object that expired or was
deleted, or a key a client kept after a failed upload. Now a **400** naming the
file and telling the user to re-attach it, with three assertions covering the
status, the message, and that the storage path does not leak.

**Cycle 3 — the price goes where the money is spent.** Three calls, recorded in
[DEC-022](DECISIONS.md#dec-022): the answer→usage link is `on delete set null`
rather than `cascade`, because billing history a user can delete is not billing
history; old rows are **not** backfilled, because correlating them by timestamp
would be right most of the time and silently wrong the rest; and the displayed
price is read from the stored cost rather than recomputed, so a rate change
cannot rewrite what last month cost. An answer that cannot be priced shows no
price — never `$0.00`.

`usage_logs` is service-role only, so the loader bypasses RLS and scopes every
query to an authenticated user id. **That scope is the whole authorization
boundary**, so `verify:costs` was run with it deliberately removed: a stranger
then read `$0.000515` and one priced message. Restored, it reads nothing.

**Two checks in that suite open a browser, and they earned their place.** The
first run of this feature had the price present in the DOM and *not visible* —
every arithmetic assertion passed while nothing appeared on screen. Confirmed
non-vacuous by setting `display: none` on the stamp and watching the suite fail.

One consequence logged rather than fixed: [ISSUE-039](ISSUES.md#issue-039)
(Perplexity bills per search as well as per token) was a reporting gap on an
admin dashboard and is now a number shown to a user. It stays Low only because
no Perplexity key is configured here; it must be fixed before one is.

**Cycles 4–6 — I built the thing that looks at pages, and it immediately found
what 27 suites could not.** Every existing suite asserted rows, bytes or source
text. None opened a page. `verify:pages` renders all 16 routes at 360, 768 and
1440 and fails on sideways overflow, console errors, unnamed controls, missing
alt text, skipped heading levels, tap targets under the WCAG 2.2 minimum, and a
keyboard walk to the composer.

Three of its own checks were wrong before any of them were right, and each was
proven so by deliberately breaking the app:

- **The obvious overflow test is vacuous here.** `scrollWidth > clientWidth` on
  `<html>` never fires — a deliberately 2200px-wide element left the document at
  exactly 360px, because the shell clips. Replaced with a scan of every clipping
  container, which found the real defect on its first run.
- **An 18px switch is a 34px target**, because the component pushes its hit area
  out with a pseudo-element. Measuring the element's own box condemned a control
  that is fine.
- **WCAG exempts a target inside a sentence.** My approximation ("the parent is
  12 characters longer") called *"No account? Create one"* a standalone control,
  by one character. It now tests the criterion itself.

`verify:failures` then induced six real failures — wrong password, unknown
address, spent budget, hourly limit, suspension, a model the provider no longer
has — and read what the screen said. It found the suspended banner was a dead
end, and that `role="status"` is not an error channel: the collector was
reporting *"Loading conversation…"* as the app's answer to a spent budget. Its
leak detector is checked against five known-bad strings before it is trusted,
because a regex that matches nothing passes every "leaks nothing" assertion in
the file.

Twice the test was wrong rather than the app, and both are recorded in the
commit rather than quietly corrected: the daily budget refuses once usage has
*reached* the limit rather than predicting the next turn, and an absolute
message count proves nothing when an earlier section of the same suite sends a
message on purpose.

That suite's capability check was also selecting any enabled non-vision model,
which after this change was one the app would never offer — so it had quietly
stopped testing capability refusal. It now selects from the models actually
offered, and says so when none is text-only rather than passing silently.
