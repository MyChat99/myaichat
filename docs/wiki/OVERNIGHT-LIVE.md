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
- **Land on a sign-in page that looks like the product and says what it is.**
  It was a bare card in an empty page — no name, no description, nothing
  connecting it to the design behind it. It now carries the masthead, sets its
  fields in the composer's mono rail, and says "Multi-provider AI chat", which
  nothing on that page said before.
  → `docs/screenshots/login/gate-light.png`, `gate-dark.png`
- **Read the conversation you are in.** The selected card in the sidebar was
  painted in one ink and lettered in another that belonged to a different pair —
  effectively invisible on the single item you are looking at. It affected
  **8 of the 14 palette-and-mode combinations**: every palette in dark, worst at
  1.30:1, and Blueprint in light as well. (Cycle 10 reported this as a dark-mode
  defect. That was measured on the default palette only, and it was wrong —
  corrected here rather than edited above.) Code comments were also under AA in
  light mode.
- **Be told what to do when you are suspended.** The banner said you could read
  but not send. It now also says who to ask to have it lifted.
- **Send a message with a stale attachment and get told what to do**, instead of
  a blank failure. An attachment whose file is no longer in storage used to
  return a 500 with a vendor stack in the server log; it now says
  *"holiday.png could not be read from storage. Remove it and attach it again."*

---

## § WHAT I NEED FROM YOU

Ordered by what it unlocks. Each one is a single sitting — I have written them
as steps rather than as problems, because every one of them is blocked on
something only you can reach, not on a decision I owe you.

### 1. Turn uploads and email on — 10 minutes, unblocks two finished features

Uploads, avatars and email are **built and tested locally end to end.** They are
disabled in production for one reason: the credentials are not in Railway.

Railway → your service → **Variables** → add six:

```
R2_ACCOUNT_ID=            # Cloudflare → R2 → Account ID, right sidebar
R2_ACCESS_KEY_ID=         # the R2 API token
R2_SECRET_ACCESS_KEY=     # shown once, at creation
R2_BUCKET_NAME=myaichat   # must match the bucket name exactly
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=onboarding@resend.dev   # until a domain is verified
```

`isStorageConfigured()` requires **all four** R2 values — three of four leaves
the paperclip greyed out with no error anywhere, which is the usual way this
half-works.

**How you will know it worked:** the paperclip in the composer is enabled on the
live site, and this passes:

```
npm run verify:upload -- --base=https://myaichat-production.up.railway.app
```

Full detail: `PHASE-6-CHECKLIST.md` A4. This closes ISSUE-016, ISSUE-017 and
ISSUE-003 together — they are three entries for one missing set of variables.

### 2. Decide about 366 untagged demo rows — 2 minutes, your call not mine

`--demo` once wrote fabricated `usage_logs` rows with nothing marking them as
fabricated. That is fixed going forward, but the rows written before the fix are
still in your analytics and are indistinguishable from real usage *by the same
argument that caused the bug*.

There is a defensible discriminator — the first commit is 2026-07-30, so
anything older is necessarily fabricated — but acting on it means deleting
analytics data on my inference. **Say the word and I will do it; I will not do
it unasked.**

```sql
select count(*) from usage_logs where created_at < '2026-07-30' and source is null;
-- then, only if the count looks right:
delete from usage_logs where created_at < '2026-07-30' and source is null;
```

(ISSUE-031.)

### 3. Two things you can safely say "no" to

Listed so they are not invisible, not because I think you should do them.

- **Gate the Railway deploy on CI** (ISSUE-027). Branch protection already means
  `main` cannot receive a commit that failed CI, so every deploy is already from
  a green commit. The remaining gap is a minute or two where production runs a
  commit whose CI has not finished. Steps are written out if you want them.
- **Three identifiers in the public repo** (ISSUE-022). The history is clean —
  zero credential hits across every commit. What remains is your own name, email
  and Supabase project ref, which are ordinary things to have in a public repo.

Nothing else is waiting on you. Everything in EVERYTHING ELSE was done without
you.

## § EVERYTHING ELSE

### Cycle log

| # | Work | Value gate | Outcome | Class |
|---|---|---|---|---|
| 0 | Pre-flight: merged PR #46, baselined suite, verified Playwright | — | 25 suites green, 1,176 assertions | — |
| 1 | Unconfigured providers offered models that could not answer; missing attachment returned 500 | Helps anyone on the live site: they stop being offered models that fail on send, and a stale attachment tells them what to do | Merged (PR #47) | CORRECTNESS |
| 2 | **Ask the presses** — one prompt to up to four models, side by side, with cost, tokens and time-to-first-token | Helps you (demo) and any visitor: they can see four vendors answer the same question and what each cost, which needs the abstraction and our per-message token data | Merged (PR #48) | USER-VISIBLE |
| 3 | **Cost transparency** — what each answer and each conversation cost, plus a running month total | Helps you and every user: the app charged for tokens and showed the number only to admins. Needs our per-message token rows, which a wrapper around one vendor's API does not have | Merged (PR #49) | USER-VISIBLE |
| 4 | The mobile nav was unreachable; `verify:pages` renders every route at 360/768/1440 | Helps anyone who opens this on a phone — they could not sign out or reach settings | Merged (PR #51) | CORRECTNESS |
| 5 | `/login` and `/signup` had never been rendered by any suite; the sign-in page mixed square and round | Helps every visitor: it is the first page anyone sees, and it did not look like the product | Merged (PR #52) | USER-VISIBLE |
| 6 | `verify:failures` induces six real failures in a browser and reads what the screen says | Helps anyone who hits a limit or an outage: they now get a message that says what happened and what to do | Merged (PR #53) | CORRECTNESS |
| 7 | `/api/compare` accepted the same model twice — billed twice, rendered both answers into both columns | Protects anyone using the comparison: a crafted request cost double for one answer | Merged (PR #55) | SECURITY |
| 8 | ARCHITECTURE gained the comparison path and the cost link; SHOWCASE's numbers were a week stale | Helps you demo it and anyone read it — the route that best shows off the abstraction was undocumented | Merged (PR #56) | DOCS |
| 9 | **The sign-in page** now carries the masthead and says what the product is | Helps every visitor: the first page anyone sees looked like a scaffold and named nothing | Merged (PR #58) | USER-VISIBLE |
| 10 | The **selected** conversation card was 1.43:1 in dark; code comments 4.14:1 in light | Helps anyone using dark mode: the one item on screen you are looking at was nearly invisible | Merged (PR #60) | CORRECTNESS |
| 11 | Contrast now measured in all 7 palettes, both modes — and the cycle-10 defect was worse than I reported | Protects every palette from the same class of pairing bug, not just the default one | Merged (PR #62) | CORRECTNESS |

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

---

## § THE MORNING BRIEFING

Written to be read in three minutes, before the sections above.

### What happened

**Eleven pull requests, all merged, all with CI green on the exact commit.**
Zero regressions: the suite went from 25 suites / 1,176 assertions to **29
suites / 1,536 assertions**, and every run since has passed with shared state
unchanged.

Two features shipped complete, as briefed — **Ask the presses** and **cost
transparency** — and then the night turned into something I did not plan.

### The thing that mattered most, and I did not see it coming

I built a suite that opens pages. It found, immediately, that **the navigation
was unreachable on a phone**: at 360px, Presses, Profile, Appearance, Admin and
Sign out were all past the right edge — clipped away by an `overflow: hidden`
with no scrollbar to hint they existed. You could not open settings or sign out
from a phone at all.

That had been true for some time, past 1,176 passing assertions. Every suite in
this repo asserted rows, bytes or source text. **None of them had ever opened a
page.** The same suite then found the sign-in page rendering in two different
design languages, and a second suite found the app answering a spent budget with
the word "Loading".

If you take one thing from tonight: the gap was never in how much was tested. It
was that nothing looked.

### What I would want you to check first

1. **Open the live site on your phone.** That is the fix I am least able to
   prove is *right* rather than merely *not broken* — I verified it at three
   fixed widths in a headless browser, not on a real device with a real thumb.
2. **The sign-in page**, light and dark. It is the one change tonight that is a
   design opinion rather than a defect being fixed, and it is the first thing
   any visitor sees.
3. **Send one message and look under the answer.** The price should be there,
   and the masthead should show a running total.

### Honest assessment

**What I am confident in.** The two features are complete and tested against
stored state, not response shape. The security-relevant work — the ownership
scope on conversation costs, the duplicate-model fix, the pre-spend refusal —
was proven by deliberately breaking each check and watching it fail. Nothing
merged on a red or stale CI run. No secret was logged, printed or committed, and
no control was weakened to make anything pass.

**What I am less confident in.** The mobile fix is verified at 360, 768 and
1440 in Chromium only — not on iOS Safari, which has its own opinions about
`dvh` and safe areas. The sign-in redesign is taste, and you may disagree with
it; it is one file and one CSS block, and reverting it costs nothing.

**The one to read if you read only one.** Measuring contrast, my own maths was
wrong before it was right. `getComputedStyle().color` returns `oklch(...)` for
anything built with `color-mix()`, and my parser read the first three numbers as
RGB — so `oklch(0.83 0.115 350)` came through as RGB(0.83, 0.115, 350). It
invented a 2.85:1 failure for a colour that actually measures 5.97:1, **and I
had already written a change to the syntax highlighting on the strength of it**
before I stopped to check why light mode moved and dark mode did not. The change
was discarded; the real defect was somewhere else entirely. A measuring
instrument gets checked before its readings do.

**Where I was wrong tonight, and corrected it in the open.** Three of the new
suite's own checks were wrong before they were right, and I only know that
because I broke the app on purpose to test them — the headline overflow check
does not fire at all in this layout, and I would have shipped it as a green
light on a broken page. Twice a test I wrote reported a bug that was not there:
the daily budget refuses once usage has *reached* the limit rather than
predicting the next turn, and an absolute message count proves nothing when an
earlier section of the same suite sends a message on purpose. Both are recorded
in the commits rather than quietly fixed. I also found that a previous session's
edit had left half of `DECISIONS.md` inside an unclosed code fence; that is
fixed and said so.

**What I deliberately did not do.** I did not delete the 366 untagged demo usage
rows, because that means destroying analytics data on my own inference — it is
in § WHAT I NEED FROM YOU with the count query first. I did not override
`postcss` or `sharp` to clear three advisories, because neither has an exposure
path here and overriding a framework's pinned native dependency trades a real
deploy risk for no reduction in actual exposure; the reasoning is written into
ISSUE-006 rather than left implicit. I touched no dashboard.
