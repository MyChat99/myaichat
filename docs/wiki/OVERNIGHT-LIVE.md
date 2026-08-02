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

That suite's capability check was also selecting any enabled non-vision model,
which after this change was one the app would never offer — so it had quietly
stopped testing capability refusal. It now selects from the models actually
offered, and says so when none is text-only rather than passing silently.
