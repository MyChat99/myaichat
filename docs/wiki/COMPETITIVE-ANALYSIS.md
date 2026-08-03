# Competitive analysis

**Researched 2026-08-02, timeboxed to 20 minutes.** Web search was available and
was used; sources at the bottom. Feature sets at this level move monthly, so
treat specifics as "true in August 2026" and re-check before betting on them.

Everything here is judged against the same gate the rest of this project uses:
**visible in a 30-second demo · testable headlessly · no new paid service · no
security or cost-control compromise · no maintenance burden without user-visible
value.** An idea that fails the gate is rejected here even when a competitor
does it well.

---

## 1. Feature matrix

Legend: ✅ have · ◐ partial · ✗ don't have · — not applicable

| | ChatGPT | Claude | Gemini | Perplexity | **myaichat** |
|---|---|---|---|---|---|
| Streaming responses | ✅ | ✅ | ✅ | ✅ | **✅** |
| Markdown + syntax highlighting | ✅ | ✅ | ✅ | ✅ | **✅** |
| Copy code button | ✅ | ✅ | ✅ | ✅ | **✅** |
| Stop generation | ✅ | ✅ | ✅ | ✅ | **✅** |
| Conversation history + search | ✅ | ✅ | ✅ | ✅ | **✅** |
| Pin / rename / delete | ✅ | ✅ | ✅ | ✅ | **✅** |
| Copy / regenerate / edit-and-resubmit | ✅ | ✅ | ✅ | ◐ | **✅** |
| Model selector | ✅ | ✅ | ✅ | ✅ | **✅** (across 4 vendors) |
| Image attachments | ✅ | ✅ | ✅ | ✅ | **✅** |
| **Document attachments** (PDF/docx/xlsx/csv) | ✅ | ✅ | ✅ | ✅ | **✗** |
| **Folders / projects** | ✅ | ✅ | ◐ | ✅ (Spaces) | **✗** |
| **Persistent memory across chats** | ✅ | ◐ | ✅ | ◐ | **✗** |
| **Web search / citations** | ✅ | ✅ | ✅ | ✅ (core) | **✗** |
| **Share a conversation by link** | ✅ | ✅ | ✅ | ✅ | **✗** |
| Voice input / spoken conversation | ✅ | ◐ | ✅ | ◐ | **✗** |
| Image generation | ✅ | ✗ | ✅ | ◐ | **✗** |
| Code execution / analysis sandbox | ✅ | ✅ | ✅ | ✗ | **✗** |
| Connectors (Drive, GitHub, MCP…) | ✅ | ✅ | ✅ | ◐ | **✗** |
| Export conversation | ◐ | ◐ | ◐ | ◐ | **✅** (.md / .json, one click) |
| Themes beyond light/dark | ✗ | ✗ | ✗ | ✗ | **✅** (7 palettes, font size, bubble style) |
| Command palette | ✗ | ✗ | ✗ | ✗ | **✅** (⌘K) |
| **Per-answer cost shown to the user** | ✗ | ✗ | ✗ | ✗ | **✅** |
| **Several models answering side by side** | ✗ | ✗ | ✗ | ✗ | **✅** (Ask the presses) |
| **Self-hosted admin: keys, models, budgets** | — | — | — | — | **✅** |
| **Per-user rate limit + daily token budget** | — | — | — | — | **✅** |
| **Audit log of every admin mutation** | — | — | — | — | **✅** |

The bottom five rows are the honest summary of where this project stands: it is
not trying to be a fifth frontier chat app, and the things it already does that
none of them do are all consequences of being **multi-vendor and self-hosted**.

---

## 2. TABLE STAKES WE LACK

Ranked by how badly the absence is felt by someone using this daily.

### 1. Document attachments — *adapt*
**Felt worst.** The paperclip exists and takes images only. A user drags in a PDF
or a spreadsheet, which is the single most common real task after plain
conversation, and it is refused. Every competitor has had this for years.
**Adapt, not adopt:** they all run server-side extraction pipelines. Ours should
pass documents through natively where the provider supports it and extract
text/tabular content where it doesn't — a decision the provider abstraction is
the right place to make, and one no single-vendor app has to think about.
*Gate: passes.* Demoable in 10 seconds, testable per file type, no new service.

### 2. Folders / projects — *adapt*
Felt on the second day of real use. Twenty conversations in, a flat list stops
being navigable. ChatGPT Projects and Claude Projects also carry shared
instructions and files; **the folder half is table stakes, the shared-context
half is not** — start with grouping and stop there until asked.
*Gate: passes.*

### 3. Share a conversation by link — *adapt, carefully*
Every competitor has it and people expect it. But a public link is a new
unauthenticated surface on a self-hosted app, and getting it wrong leaks whole
conversations. **Adapt:** expiring, revocable, explicitly opt-in per conversation,
and a redacted copy rather than a live view. If it cannot be built that way in
the time available, do not build it at all.
*Gate: passes, with the security work counted in.*

### 4. Web search with citations — *reject for now*
Table stakes for a research tool, not for this one — and it is the one item here
that **fails the gate**: it needs a paid search API, ongoing cost per query, and
a whole citation-rendering surface. There is a cheaper honest option: Perplexity
is already one of our four registered providers and does search natively, so
"pick the Sonar model when you want cited answers" is a real answer that costs
nothing to build. Revisit only if someone asks.

### 5. Persistent memory across chats — *reject for now*
Genuinely useful and genuinely a maintenance burden: a memory store needs
extraction, review, editing, deletion, and an audit trail, or it becomes a
privacy problem in a self-hosted product where the admin can read the database.
Large build, invisible in a 30-second demo until it happens to fire.
*Fails the "no maintenance burden without user-visible value" clause today.*

### 6. Voice input — *reject*
Requires either a paid speech service or shipping a model. Fails "no new paid
service" outright.

---

## 3. DIFFERENTIATORS WE COULD OWN

Things none of them do well, or structurally cannot, that our architecture makes
cheap.

### A. Ask the presses — **already shipped**
One prompt, up to four vendors, side by side, with cost and time-to-first-token
per column. **None of the four can build this**: each is a shop window for its
own models. Perplexity comes closest by letting Pro users pick a backing model,
but it will never show you GPT and Claude disagreeing in adjacent columns with a
price on each. This is the demo.

### B. Per-answer cost — **already shipped**
Every one of them hides cost behind a subscription; the number does not exist in
their UI because it is not in their interest for it to. We have per-message token
counts, so the price under each answer is arithmetic we already own.

### C. "What would this have cost on another model?" — *adopt, high value*
The natural extension of B, and the sharpest thing on this list. Every answer
already stores its input/output tokens; every model row already stores its
per-1K prices. So for any answer we can show **what that exact answer would have
cost on each other configured model** — no second API call, no tokens spent, pure
arithmetic over data already in the database.
*Why only we can: it needs per-message token data (B) and a multi-vendor price
table (the abstraction) in the same product.* Demoable instantly, trivially
testable, zero marginal cost. **Top of the build list after table stakes.**

### D. A cost ceiling users can see and set — *adapt*
We already enforce a daily token budget per user; it is invisible until you hit
it. Surfacing "you have used 40% of today" turns a punitive limit into a useful
one. Self-hosted only: none of them will show you a spend meter.

### E. Model routing by task, chosen by the admin — *adapt, later*
"Cheap model for short questions, expensive for long ones" is a policy a
self-hosted deployment can set and a hosted product cannot offer without
undermining its own pricing. Real value, but it is a settings surface plus a
routing layer — too big for a short session and easy to get subtly wrong.

### F. The press design system itself — *keep*
Seven palettes, two inks each, one permanent layout. All four competitors look
like the same white SaaS app. This is not a feature anyone asks for and it is the
first thing anyone notices.

---

## 4. DELIBERATELY NOT WORTH COPYING

| Feature | Why they have it | Why it is wrong here |
|---|---|---|
| **Image generation** | Drives consumer signups and showcases their own image models | Another paid vendor, another key, another moderation surface. Nothing to do with the thing this app is good at. *Reject.* |
| **Code execution sandbox** | Retention, and it showcases agentic capability | Arbitrary code execution in a self-hosted app is the single largest security surface you could add. Directly violates "never weaken a security control". *Reject.* |
| **Connectors (Drive, Gmail, GitHub)** | Lock-in — the more of your data lives there, the harder you are to leave | Each one is an OAuth surface, a token store and a permanent maintenance obligation. *Reject* until one is specifically asked for. |
| **Cross-chat memory harvesting** | Training signal and personalisation at scale | In a self-hosted product the admin can read the store, so silently accumulating inferred facts about users is a privacy liability, not a feature. *Reject as designed; revisit only as explicit, user-editable, deletable notes.* |
| **Agent / computer-use modes** | Frontier positioning and enterprise deals | Unbounded cost with no ceiling anyone can predict — the exact opposite of a product whose distinguishing feature is showing you what things cost. *Reject.* |
| **Removing chat framing for "canvas"** | Suits their document-editing ambitions (and ChatGPT itself removed Canvas again in GPT-5.5) | A large UI surface chasing a direction its own originator reversed. *Reject.* |
| **Usage tiers / plan gating** | Revenue | There is no revenue model here. The admin sets budgets; that is the whole story. *Reject.* |

---

## 5. Shortlist, ranked for build order

Written into [ROADMAP.md](ROADMAP.md). Ranked by *(demo value × confidence it can
be finished completely)* ÷ *risk*.

| # | Item | Why here | Size |
|---|---|---|---|
| 1 | **Document attachments** | Worst-felt gap; the paperclip already exists and lies | L |
| 2 | **"What it would have cost elsewhere"** | Pure arithmetic on data we already store; nobody else can show it | S |
| 3 | **Folders** | Second-worst gap; needed by day two of real use | M |
| 4 | **Visible budget meter** | Turns an invisible limit into a usable one | S |
| 5 | **Share link** | Expected — but only if expiring, revocable and opt-in | M |
| 6 | Model routing policy | Real self-hosted advantage, too large and too subtle for a short session | L |
| 7 | Memory / web search / voice | Rejected above, recorded so the decision is not re-litigated | — |

---

## Sources

- [ChatGPT Features 2026: Projects, Memory, Agent, Sora and More — Suprmind](https://suprmind.ai/hub/chatgpt/features/)
- [ChatGPT Features in 2026: The Complete Guide — chat-power](https://www.chat-power.com/blog/chatgpt-features-complete-guide-2026/)
- [ChatGPT vs Claude vs Gemini vs Perplexity (2026) — Free Press Journal](https://www.freepressjournal.in/tech/chatgpt-vs-claude-gemini-vs-perplexity-2026)
- [ChatGPT, Claude, Gemini or Perplexity: superpowers compared — Clickforest](https://www.clickforest.com/en/blog/ai-tools-superpowers)
- [ChatGPT vs Claude vs Gemini vs Perplexity: 2026 Honest Comparison — Suprmind](https://suprmind.ai/hub/chatgpt/vs-other-ai/)
- [ChatGPT vs Claude: Which AI Should You Use in 2026? — MindStudio](https://www.mindstudio.ai/blog/chatgpt-vs-claude-2026-comparison)
