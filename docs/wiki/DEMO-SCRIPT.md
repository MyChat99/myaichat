# Three-minute demo script

A click-path to follow while screen-recording. Timings are a guide; the order is
not — each beat sets up the next, and the admin section only lands if the chat
section has already shown the thing being administered.

**What this is optimised for:** someone who watches 40 seconds and decides
whether to keep watching. The interesting claim is *multi-provider with your own
keys*, so that has to be visible before the first minute is out.

---

## Before you hit record

```bash
npm run seed -- --demo     # 24 conversations, 98 messages, 49 usage rows over 30 days
npm run dev
```

- [ ] **Sign in first.** Nobody wants to watch you type a password, and the
      login screen is the least interesting thing here.
- [ ] **Leave the default theme alone.** The default is now Riso — newsprint
      paper, Federal Blue ink, hard black keylines. It does not look like every
      other chat app, which is the whole point, and switching away from it on
      camera gives that away for free.
- [ ] **Close the terminal**, and anything else on screen. Notifications off.
- [ ] **Check the header**: your account email is in it. Fine if you do not mind
      it public.
- [ ] **Have a second browser window** already on `/admin/providers`, so the
      switch at 1:40 is instant rather than three clicks of navigation.
- [ ] **Do not open the paperclip.** File storage is not configured; the button
      is correctly disabled, and lingering on it invites the one question you
      cannot answer well.

Record at **1920×1080**, and keep the browser at a normal zoom — 110% if the
text looks small on playback.

---

## 0:00 – 0:35 · Streaming chat

**Click:** the empty state's first starter prompt, *"Explain closures in
JavaScript with an example"*.

**Say:**

> This is a multi-provider AI chat platform. You bring your own OpenAI and
> Anthropic keys, and everything runs through your own infrastructure.

**Let it stream.** Do not talk over the first two seconds — the token-by-token
render is the thing people are watching, and narration competes with it.

**Then, while it finishes:**

> Streaming is server-sent NDJSON rather than SSE, because the request is a POST
> — it carries the conversation and the message, and EventSource can't do that.

**Click:** the copy button on the code block. One second. It is a small detail
and it signals that the small details were done.

---

## 0:35 – 1:00 · Switching model mid-conversation

**Click:** the model selector in the header. **Pause on the open menu** — both
providers visible, grouped, with costs.

**Say:**

> Here's the part I care about. These are two different vendors with genuinely
> different APIs, and I can switch between them inside the same conversation.

**Select the other provider. Type:** `Which model are you, and how do you know?`

**Let it answer.** The answer is the demo: it names itself correctly *because the
app tells it*, and it says so.

**Say, over the reply:**

> A model can't reliably identify its own version — it shipped after its
> training data was collected. The app puts the selected model's name in the
> system prompt, which is why that answer is trustworthy here and often isn't
> elsewhere.

---

## 1:00 – 1:20 · Ask the presses

**Click:** Presses.

**Select a second and third model** — the chips overprint as you pick them.

**Type:** `Explain a closure in one sentence.` **and press Set it.**

**Say, while they stream side by side:**

> One prompt, three models, at once. This is the thing the abstraction buys:
> they're different vendors with different APIs, and the app doesn't know or
> care.

**Wait for the footers.** Then, pointing at them:

> Every answer carries what it cost, how many tokens it used, and time to first
> token — which is the number that decides whether a model *feels* fast. The
> summary underneath names the cheapest and the first to answer.

**Say if the costs differ by an order of magnitude, which they usually do:**

> That's the same question answered for a fraction of a cent and for twenty
> times that. Being able to see that is the point.

---

## 1:20 – 1:40 · Themes

**Click:** Appearance.

**Click through three presets, then come back to Riso** — one every two
seconds. Do not narrate the colours; the screen is doing that. Ending where you
started is what shows the default was a choice.

**Say:**

> Eight themes, light and dark, per user. The default is a risograph print
> look — paper stock rather than a white page, and two real Riso inks. The
> interesting bit is that there's no flash on load: both token sets are
> server-rendered and a tiny inline script resolves the system preference before
> first paint.

**Change the accent colour once.** It applies live, with no reload — that is the
point worth showing.

**Say:**

> Every theme is checked against WCAG AA contrast automatically — computed from
> the token data, so adding a theme gets it checked without anyone writing a new
> test. Three of Riso's ink colours had to be darkened to clear AA, and that
> test is how I found out which three.

---

## 1:25 – 2:05 · Admin, and the re-auth moment

**Switch to the second window** — `/admin/providers`.

**Say:**

> Provider keys are AES-256-GCM encrypted at rest. Only the last four are ever
> rendered, and the key never reaches the browser.

**Click:** *Test connection*. **Wait for the green result and the latency.**

**Say:**

> That's a real one-token generation, not an auth check. A key with no credit
> lists models perfectly happily and only fails when you ask it to write
> something — which cost me an afternoon to learn.

**Click:** *Rotate*. **The password prompt appears.**

**Say — this is the beat that lands:**

> Changing a provider key asks for my password again. A stolen session shouldn't
> be enough to swap the key that bills my account. It's enforced in the server
> action, not the dialog — the dialog is just the prompt.

**Type a wrong password. Show the rejection. Then cancel.** Do not actually
rotate the key on camera.

---

## 2:05 – 2:35 · Analytics

**Click:** Overview.

**Say:**

> Messages today, spend today, spend over thirty days, and live provider health
> — checked with a real generation and cached, so looking at this page doesn't
> bill the account.

**Click:** Analytics. **Let the charts render.**

**Say:**

> Aggregated server-side with a hard row ceiling. And the queries are indexed
> against a benchmark rather than a guess — the index on this deployment was
> chosen by measuring a 200,000-row table, because the real one has 178 rows and
> Postgres correctly ignores every index at that size.

**Click:** a user, into the drill-in. Two seconds on the per-model breakdown.

---

## 2:35 – 3:00 · Audit log, and close

**Click:** Audit log.

**Say:**

> Every admin mutation, written server-side with the service key so entries
> can't be forged from a browser.

**Click:** *Export CSV*. **Show the file downloading.**

**Say:**

> Exporting is itself audited — an export that leaves no trace is a gap in the
> thing it's exporting. And cells that start with an equals sign get defused,
> because a spreadsheet would otherwise run them as formulas.

**Close on the chat screen**, not the admin panel.

**Say:**

> Next.js 16, Supabase with row-level security on all twelve tables, TypeScript
> strict throughout. No test framework — twenty-four suites, just over a thousand
> assertions, every one against the real database or the real running server.
> Code's in the description.

---

## Things to say only if asked

- **"Is it finished?"** — No, and the repo says so. File uploads are built and
  tested up to the storage call and are waiting on credentials. The
  accessibility audit needs a browser I can't automate.
- **"Why no tests?"** — There are 1,085 assertions; there is no *framework*. The
  bugs this project actually hit — an RLS policy that recursed, a query that
  returned the oldest rows instead of the newest, an unauthenticated POST
  answering 200 with an HTML page — are not the kind a mocked unit test catches.
- **"Why two providers?"** — To prove the abstraction. Adding a third is one
  adapter file and one registry line, and there's a test that greps the tree and
  fails the build if a vendor SDK import escapes that folder.

## Things not to say

- Do not claim file uploads work.
- Do not quote a figure you have not re-checked — `npm run verify:all` prints
  the current counts.
- Do not say "production-ready" without saying what is not ready. The honesty is
  the differentiator; every other demo claims to be finished.
