# Provider abstraction

All LLM access goes through the `ChatProvider` interface in [types.ts](types.ts).
Nothing outside this directory imports a vendor SDK or branches on a provider name.

## Adding a third provider

Two steps. No changes to routes, UI, or the database schema.

### 1. Write one adapter file

Create `lib/providers/<name>.ts` exporting a `ChatProvider`:

```ts
import 'server-only';

export const mistralProvider: ChatProvider = {
  name: 'mistral', // must equal the `providers.name` row
  async *streamChat(params) { /* yield text → done, or error */ },
  async listModels() { /* ProviderModel[] */ },
  async validateKey() { /* KeyValidation */ },
};
```

Three rules:

- **`import 'server-only'` at the top.** The API key must never reach a client
  bundle. This makes an accidental client import a build error rather than a leak.
- **Normalise errors to `ProviderError`.** The UI reacts to `kind`
  (`auth`, `quota`, `rate_limit`, `context_length`, `network`, `provider`,
  `unknown`), never to a vendor status code. Messages are shown to users, so
  they must not carry key material or raw vendor payloads.
- **`validateKey()` must spend a token.** Do not implement it as a models-list
  call. An unfunded key lists models happily and fails only on generation —
  Phase 3 was blocked by exactly that, twice.

Register it in [registry.ts](registry.ts):

```ts
const ADAPTERS: Record<string, ChatProvider> = {
  [anthropicProvider.name]: anthropicProvider,
  [openaiProvider.name]: openaiProvider,
  [mistralProvider.name]: mistralProvider, // ← the only line that changes
};
```

### 2. Add database rows

One `providers` row (`name` must match the adapter's `name`) and one `models`
row per model. Add them to `CATALOGUE` in [scripts/seed.ts](../../scripts/seed.ts),
or via the Phase 4 admin panel once it exists.

A model is offered to users only when **all** of these hold: the model is
enabled, its provider is enabled, and an adapter is registered for that provider
name. A models row naming an unregistered provider is skipped silently by
`listAvailableModels()` — but `getAdapter()` throws if a request somehow reaches
it, so misconfiguration surfaces loudly rather than as a broken chat.

## What lives where

| File | Responsibility |
|---|---|
| [types.ts](types.ts) | The contract: `ChatProvider`, message/event shapes, `ProviderError` |
| [anthropic.ts](anthropic.ts) | Anthropic adapter — the only file that knows Anthropic's API |
| [openai.ts](openai.ts) | OpenAI adapter — the only file that knows OpenAI's API |
| [registry.ts](registry.ts) | Name → adapter map, and DB rows → `ResolvedModel` |

`app/api/chat/route.ts` asks the registry for a model, gets an adapter, and
streams. It names no vendor.

## Differences the abstraction absorbs

Worth knowing when writing a new adapter — the two existing ones differ more
than their shared interface suggests:

| | Anthropic | OpenAI |
|---|---|---|
| System prompt | separate `system` field | first message in the array |
| Output cap | `max_tokens` | `max_completion_tokens` (GPT-5 renamed it) |
| Usage while streaming | on the final message | only if you pass `stream_options.include_usage` |
| Out of credit | a 4xx with a billing message | 429 with `code: insufficient_quota` |
| Tiny output budget | truncates happily at `max_tokens: 1` | **errors** — `invalid_request_error` if the budget can't fit a whole message |

That last row matters: OpenAI returns the same HTTP status for "slow down" and
"you have no money". They map to different `kind`s because one clears in seconds
and the other needs a payment — telling a user to retry shortly forever is worse
than saying nothing.
