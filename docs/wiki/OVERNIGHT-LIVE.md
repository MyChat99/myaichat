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

### 1. ~~Turn uploads and email on~~ — **DONE 2026-08-02, and verified**

You added the six variables. Verified against production, not locally:

| Check | Result |
| --- | --- |
| `isStorageConfigured()` on the live site | **true** — the paperclip is enabled, and `/api/uploads/presign` answers 200 rather than 503 `storage_unconfigured` |
| CSP as served | both R2 hosts present in `connect-src` |
| `verify:upload --base=…up.railway.app` | **9/9** — presign 200, cross-origin PUT 200, message stored with attachment, model described the image, object read back |
| `smoke --url …up.railway.app` | **19/19** |
| Timing | presign 945ms, PUT 272ms, composer usable 4.5s after attaching |

**One thing is still open, and it needs your inbox:** email *delivery*. I can
prove the template renders and the transport is configured; I cannot prove a
message arrived. Sign up on the live site with the address that owns the Resend
account — it must be that address, since `onboarding@resend.dev` is an
unverified domain and Resend delivers only to the account owner. (ISSUE-017.)

<details>
<summary>What the original item said</summary>

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

</details>

### 2. Decide about **75** untagged demo rows — 2 minutes, your call not mine

**Correction:** I wrote 366 here and in the briefing. That was the size of the
whole table, not the number of deletion candidates. Counted properly:

| | rows |
| --- | --- |
| `usage_logs`, total | 846 |
| tagged `source = 'demo'` (already removable) | 49 |
| untagged, any date | 797 |
| **untagged AND before 2026-07-30 — the candidates** | **75** |

Deleting the 75 removes **23,994 tokens and $0.0779** from analytics. The other
722 untagged rows are dated on or after the first commit and are
indistinguishable from real usage; they stay whatever you decide.

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
| 12 | Focus visibility checked on all **218** tab stops across ten pages, instead of on one button | Protects anyone using a keyboard: nothing found, and it is now one careless `outline: none` away from being caught | Merged (PR #63) | CORRECTNESS |

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

**Nineteen pull requests (#47–#65), all merged, all with CI green on the exact
commit** — twelve of work, seven keeping this report and the wiki current. Zero
regressions: the suite went from 25 suites / 1,176 assertions to **29 suites /
1,591 assertions**, and every run since has passed with shared state unchanged.

(An earlier draft of this line said sixteen. I counted the work cycles and
forgot the wiki PRs; corrected here rather than above.)

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

### It is already live

Checked at the end of the session, not assumed. Railway deployed from `main` on
its own, and the served HTML carries tonight's sign-in page:

```
$ npm run smoke -- --url https://myaichat-production.up.railway.app
All 19 smoke checks passed
$ curl -s .../login | grep 'Multi-provider AI chat'   # present
```

The health endpoint reports `database: ok, encryption: ok`. Uploads and email
are still off there — that is item 1 in § WHAT I NEED FROM YOU, and it is the
only thing standing between the live site and everything this app can do.

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

---

# Short session — 2026-08-02, ~2 hours

Same three-part structure. Started from `main` @ `7bba24f`, 29 suites green.

## § WHAT YOU CAN NOW DO

- **Feel the app respond.** It did not move at all before. Lines settle into
  place, sidebar cards lift off their shadow on hover and press all the way into
  it, the send button and paperclip stamp down and hold, and the mobile panel
  slides with a scrim that fades rather than appearing. Nothing bounces — the
  design language is paper, and an overshoot curve reads as rubber.
  → `docs/screenshots/motion/before/` vs `after/` (stills; the PR describes what
  each one does, because a screenshot cannot show motion)
- **See a square caret while an answer is being set**, in the type colour, on a
  hard blink. It replaced a rounded pulsing bar — a radius in a design system
  whose whole premise is that nothing has one.
- **Read a competitive analysis** of ChatGPT, Claude, Gemini and Perplexity with
  a ranked shortlist you can pick from → `COMPETITIVE-ANALYSIS.md`, shortlist in
  `ROADMAP.md`.

## § WHAT I NEED FROM YOU

1. **Nothing is blocking.** Uploads are verified working in production
   (re-confirmed at the start of this session: 9/9 upload, 19/19 smoke, health
   ok, both R2 hosts in the CSP).
2. **Email delivery** is still the one Phase 6 item I cannot close — one signup
   on the live site with the address that owns the Resend account. Unchanged
   from this morning (ISSUE-017).
3. **The demo rows: still 75, still not deleted.** Re-counted this session.
   `usage_logs` is now 878 rows total (my own test runs added to it); 49 tagged
   `demo`, 829 untagged, and **75** untagged *and* dated before the first
   commit — the deletion candidates. Say the word.
4. **Pick the next feature** from the shortlist. My recommendation is #2, "what
   this answer would have cost elsewhere": it is small, it is pure arithmetic
   over data already stored, and it is structurally impossible for a
   single-vendor product to offer.

## § EVERYTHING ELSE

### Task 1 findings, in one paragraph

The matrix says something worth internalising: the five rows where this project
stands alone — per-answer cost, several models side by side, admin-held keys,
per-user budgets, an audit log — are all consequences of being **multi-vendor
and self-hosted**, not of being clever. The gaps that matter are document
attachments (worst-felt: the paperclip exists and takes images only, so it
currently lies about what it accepts), folders, and share links. Web search,
cross-chat memory, voice, image generation, code execution, connectors and agent
modes are all **rejected with reasons written down**, so the decisions do not get
re-litigated. The single best next build is *"what this answer would have cost on
every other model"* — no second API call, no tokens spent, and impossible for a
product that only sells one vendor's models.

### The ranking, and why

| Task | Size | Verdict |
|---|---|---|
| 2 — Document uploads | L | **Not started.** Top-ranked gap in my own analysis, and it needs new parser dependencies, content-type sniffing, extraction limits, capability gating and a negative-path test per format. Three hours minimum to do safely. A merged half of it is worse than not starting |
| 3 — Folders | M–L | **Not started.** Migration + RLS + CRUD + sidebar + persisted expand state + tests |
| 4 — Avatars | M | **Not started.** Client-side crop is fiddlier than it looks |
| 5 — Motion | M | **Shipped complete.** No schema, no new dependencies, no new API surface, and the screenshot and reduced-motion harness already existed |

The instruction was FINISH > BREADTH, and motion was the only one of the four I
was confident of finishing completely in the time left.

### What the motion work found

A real bug, in the thing that was supposed to make motion safe. `globals.css`
collapsed animation and transition **durations** under `prefers-reduced-motion`
and **not delays**. A collapsed duration with `both` fill lands harmlessly on the
end frame; a surviving delay pins an element to its *starting* frame for the
length of the delay. That is precisely why the masthead once flashed in from
`opacity: 0` — patched at the time with a rule naming the masthead, which left
every future delayed animation carrying the same bug and no such rule. Delays now
collapse globally.

Three of the new suite's own checks were wrong before they were right, which is
becoming the reliable pattern of this project: the literal-duration scan **read
its own documentation as a violation** (it sliced from a marker that sits inside
a comment, leaving an unterminated `/*` the comment-stripper could not match, so
`0.01ms` in a sentence was reported as a hardcoded duration); the
longest-animation check condemned the masthead's deliberate one-shot load
flourish, now exempt by name; and one assertion was a tautology
(`count === 0 || count > 0`) and is now a measurement.

### Left undone, deliberately

- **Page transitions between sections.** Doing them properly needs a client
  wrapper keyed on pathname around every route. Under 90% confident that was safe
  for first paint in the time available, so it was logged rather than attempted.
- **The delay assertion is not proven non-vacuous.** Two attempts to make it fail
  on demand both failed to isolate it — every animated element also carries an
  explicit hold that zeroes the delay. Stopped at the three-strike rule. It is
  kept as protection for future animations and is **not verified**. The
  layout-shift check, by contrast, is proven by construction: the page is
  rendered twice and every element must sit in identical coordinates.
- **One flake carried over** from this morning: ISSUE-041, `verify:persistence`
  failing once in a chained run and passing since. It did not recur in either
  full-suite run this session.

---

# Session — 2026-08-02, documents and cost comparison

Started from `main` @ `caf131b`, 30 suites green. Two features, both complete
and merged: PRs #72 and #73. Suite now **32 suites**.

## § WHAT YOU CAN NOW DO

A two-minute click-path. Everything below is on the live site or `npm run dev`.

### 1. Attach a spreadsheet and ask about it — 40 seconds

1. Open the chat page (`/`).
2. Click the **paperclip** at the bottom-left of the compose panel.
3. Pick any `.xlsx` — or a `.docx`, `.csv`, `.md`, `.txt` or `.pdf`. All of them
   are accepted now; before today only images, PDFs and plain text were, and
   plain text was *silently thrown away* before it reached the model.
4. **Expect:** a chip above the field showing the filename, a per-type icon, and
   a mono badge reading e.g. `SHEET · 12 KB`. → `docs/screenshots/documents/1-sheet-attached.png`
5. Type *"What is in this file?"* and press **Set it**.
6. **Expect:** the answer quotes actual values out of the sheet. Spreadsheets go
   in sheet by sheet, by name, with the header row above its data.

### 2. Watch the paperclip refuse to lie — 30 seconds

1. In a conversation, open the **model pill** in the top bar and pick a model
   that cannot read images (any text-only model).
2. Attach a **PNG**.
3. **Expect:** a pink-keylined line above the field —
   *"… can't read images. Choose a vision model, or attach a document instead."*
   — and the **Set it** button goes disabled. Before today the file uploaded and
   the server refused it afterwards.
   → `docs/screenshots/documents/4-capability-warning.png`
4. Now attach a **spreadsheet** to that same text-only model. **Expect:** no
   warning. Extraction turns it into text, so it works on a model with no
   document capability at all.

### 3. See what the answer would have cost elsewhere — 30 seconds

1. Open any conversation with a reply in it.
2. Under the answer, next to the price, click **Elsewhere**.
3. **Expect:** a table of every model this deployment could have used, cheapest
   first, each with a price and a multiple (`13× less`, `2.6× less`). The model
   that actually answered is in bold, marked *this answer*.
4. **Expect** the last line to say the numbers are an estimate, because models
   tokenise differently. Nothing was sent to produce any of it.
   → `docs/screenshots/cost-elsewhere/expanded.png`

## § WHAT I NEED FROM YOU

1. **Nothing is blocking.** Production was re-verified at the start of this
   session — 9/9 upload, 19/19 smoke, both R2 hosts in the CSP, health ok.
2. **Email delivery**, still the one Phase 6 item I cannot close: one signup on
   the live site with the address that owns the Resend account (ISSUE-017).
3. **The demo rows: still 75, still not deleted.** Say the word.
4. ~~**Try a real Office file of your own.**~~ **DONE 2026-08-02 — verified by
   you, and it changes the standing of this work.** A real `.docx` and `.xlsx`
   uploaded together returned `QVX-7741`, `Marisol Okonkwo-Brandt` and
   `PERIWINKLE-9` from the Word file, and from the workbook identified Marisol
   Heights as highest revenue at **$49,484.50** — a *computed* column — plus all
   three Anomalies rows from the second sheet. That proves three things my own
   fixtures could not: multi-file in one turn, multi-sheet through the
   relationship file, and cached formula results. Recorded as ISSUE-042,
   resolved.

## § EVERYTHING ELSE

### Cycle log

| # | Work | Outcome | Class |
|---|---|---|---|
| 13 | **Document uploads** — PDF, txt, md, csv, docx, xlsx, images kept | Merged (PR #72) | USER-VISIBLE |
| 14 | **"What it would have cost elsewhere"** under every answer | Merged (PR #73) | USER-VISIBLE |

### What the document work found

**`text` attachments never reached the model.** A `.txt` or `.md` could be
picked, uploaded, stored and drawn as a chip, and the hydration step filtered it
out and passed nothing to the provider — so the answer came back as though the
file had been read. Same code path, fixed as part of this.

**No parser dependency.** `.docx` and `.xlsx` are ZIP archives of XML and Node
ships an inflater, so the extractor is a few hundred lines rather than a new
supply-chain dependency in the one path that handles bytes an untrusted user
chose. The trade cuts both ways and is written into the module: it reads the
common shape of real Office files, and it is not a full OOXML implementation.

**Zip bombs are refused from the declared size, before anything is allocated** —
a fixture claiming to expand to 900MB is refused in under half a second, and
that timing is itself asserted. Extracted text is fenced and labelled to the
model as data, never instructions, because a spreadsheet cell reading "ignore
your instructions" is prompt injection through a file the user may not have
written.

### What the cost work found

`models.input_cost_per_1k` is `not null default 0`, so a model nobody priced
does not arrive as null — it arrives as **0 and 0**, and rendered naively it
tops the comparison at $0.0000 and reads as the cheapest option available.
Both-zero is now treated as "no price set" and sorted last. I only found it
because the test tried to insert a null and the database refused.

### Two of my own checks were wrong first, both passing silently

The capability gate had **no working test twice over**: the first version pinned
a non-vision model whose provider holds no key — the route resolves that to the
default vision model, so the gate was never reached and the check reported it
broken. The replacement searched only usable models, found none, and *skipped*:
a security-relevant gate with no test, reported green. It now creates the model
it needs.

The end-to-end check polled `document.body.innerText` across a navigation and
kept reading the page it had just left, reporting a correct answer as missing.
It asserts stored state now, which is this project's own rule.

### Not started, deliberately

**Folders** (#3 on the shortlist) and **avatars**. Both are a migration or a
crop-and-resize away from being half-done, and the instruction was FINISH >
BREADTH. Two complete features beat two complete features and a broken third.

---

# Session — 2026-08-03, performance and five device-testing fixes

Started from `main` @ `c936d2a`. PRs #75, #76, #77.

## § WHAT YOU CAN NOW DO

### 1. Notice the app answering faster — 20 seconds

1. Open the live site and click between **Page**, **Presses** and **Appearance**.
2. **Expect** the switch to feel immediate rather than delayed. Measured on the
   deployment, before and after:

| | before | after |
| --- | --- | --- |
| chat page, time to first byte | 1160ms | **695ms** |
| chat page, first paint | 1308ms | **848ms** |
| navigating back to chat | 1332ms | **829ms** |

### 2. See a top bar that lines up — 15 seconds

1. Look along the very top of the page at 1440px.
2. **Expect** "myaichat" to sit on the same line as *Page · Presses · Profile ·
   Appearance*. It was 6px low, because the masthead band was 83px tall and the
   rule beside it was 55px. → `docs/screenshots/topbar/after/band-1440.png`
3. **Expect** no `.md` / `.json` and no grey person icon. In their place, one
   **EXPORT** control — click it. → `topbar/after/export-open.png`

### 3. Find the pin and delete on a conversation — 20 seconds

1. Hover any conversation card in the sidebar.
2. **Expect** two bordered buttons at the end of the *"Claude Opus 5 · 4 notes"*
   line — not on top of the title, and clearly visible rather than blending into
   the card. On a phone they are always visible.
   → `docs/screenshots/slip/riso-dark.png`

### 4. Click a model in the cost comparison and have it actually work — 30 seconds

1. Under the **most recent** answer, click **Elsewhere**.
2. Hover a row: **expect** it to highlight and offer **Re-run**.
3. Click one. **Expect** a confirmation naming the model and the price, then the
   same question answered by that model.
4. Open **Elsewhere** under an *older* answer. **Expect** plain rows with
   nothing to press — re-running there would discard every turn after it.
   → `docs/screenshots/elsewhere/actionable.png`

## § WHAT I NEED FROM YOU

1. **Re-test the feel on your phone and iPad.** The numbers halved, but the
   fixes were measured with a headless browser on a wired connection. Whether it
   now *feels* right is the part I cannot measure.
2. **Email delivery** — still the one Phase 6 item I cannot close (ISSUE-017).
3. **The 75 demo rows** — still counted, still not deleted.

## § EVERYTHING ELSE

### What the performance investigation actually found

**Almost none of the suspects were guilty.** Measured on a production build at
4× CPU throttle, median of five:

- **Total blocking time: 0ms** on every route but one. No long tasks.
- **A streamed answer produces zero long tasks.** The motion pass is not
  implicated and nothing was removed.
- The sidebar rendering 60 conversations without windowing costs nothing
  measurable.

**The app was never choppy. It was waiting.** Every route is server-rendered and
was issuing its database reads one after another — `/` had seven sequential
`await`s, four of them inline in the JSX. Timed in isolation: **442ms sequential
against a 104ms parallel floor.**

Two changes, both of which only remove waiting: issue the independent loads
together, and stop reading the model table twice (`loadPricedModels` was a second
read of rows `listAvailableModels` had already returned — which also removed a
real bug, since two independently-filtered lists of "models you could have used"
can disagree).

**The honest part.** On localhost the change was *within noise* — one "before"
sample came out faster than the "after". It shipped on the reasoning that it can
only remove serialisation and that the deployment pays a much higher
per-round-trip cost. Re-measured on the deployment afterwards, that held: −40%
TTFB on the chat page, −38% on navigation. **But `admin` also improved by 553ms
and I changed nothing on that page**, so part of the gain is instance warmth and
I cannot honestly attribute all of it to the change. The routes I edited moved
most, and by the predicted magnitude.

`measure:perf` is committed. It reports a median of five after a discarded
warm-up, because one sample per route swamped a real effect and reported an
unchanged route as slower. It also reports React commit counts as *"not
measurable in a production build"* rather than as zero, because the devtools hook
it needs is not present there.

### Measurements behind the five UI fixes

- masthead 83px vs rule 55px; wordmark centre 32 vs tabs 26 → now 55/55 and
  27/27
- 79px of room beside the wordmark; "No. 4" needs 36px, "3 AUGUST" needs 58px —
  hence the date went, not the number
- slip controls: no overlap in any of the 14 palette-and-mode combinations,
  every target 26px, worst trash-icon contrast **8.64:1** (previously
  `--muted-foreground` against the card's own fill)

### One check that was wrong before it was right

The new "older rows are inert" assertion was first written as an `if` around a
toggle count, and ran against a conversation with no priced answers — so it
skipped in silence and reported a pass. The guard is now itself a check that
fails when the fixture cannot support the test.
