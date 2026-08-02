# Provider abstraction

All LLM access goes through the `ChatProvider` interface in [types.ts](types.ts).
Nothing outside this directory imports a vendor SDK or branches on a provider name.

## Adding a provider in five steps

No changes to routes, UI, or the database schema. If you find yourself editing
`app/api/chat/route.ts`, stop — that is the abstraction failing, not you.

### 1. Write the adapter file

Create `lib/providers/<name>.ts`. Note the shape: a **factory taking the API
key**, not a singleton. The key is decrypted per request, so an adapter that
closed over one at module load would be reading a key that may since have been
rotated in the admin panel.

```ts
import 'server-only';

export const MISTRAL_PROVIDER_NAME = 'mistral';

export function createMistralProvider(apiKey: string): ChatProvider {
  return {
    name: MISTRAL_PROVIDER_NAME, // must equal the `providers.name` row
    async *streamChat(params) { /* yield {type:'text'} → {type:'done'} */ },
    async listModels() { /* ProviderModel[] */ },
    async validateKey() { /* KeyValidation */ },
  };
}
```

### 2. Obey the three adapter rules

- **`import 'server-only'` on the first line.** The API key must never reach a
  client bundle; this turns an accidental client import into a build error
  rather than a leak.
- **Normalise every failure to `ProviderError`** with a `kind` — `auth`,
  `quota`, `rate_limit`, `context_length`, `network`, `provider`, `unknown`.
  The UI reacts to the kind, never to a vendor status code. Messages are shown
  to users, so they must carry no key material and no raw vendor payload.
- **`validateKey()` must actually generate.** Do not implement it as a
  models-list call: an unfunded key lists models perfectly happily and fails
  only on generation. Phase 3 was blocked by exactly that, twice (ISSUE-012).

### 3. Register the factory

One line in [registry.ts](registry.ts) — and this is the only place outside the
adapter where the provider's name appears anywhere in the codebase:

```ts
const ADAPTERS: Record<string, (apiKey: string) => ChatProvider> = {
  [ANTHROPIC_PROVIDER_NAME]: createAnthropicProvider,
  [OPENAI_PROVIDER_NAME]: createOpenAIProvider,
  [MISTRAL_PROVIDER_NAME]: createMistralProvider, // ← the only line that changes
};
```

### 4. Add the database rows

One `providers` row whose `name` matches the adapter exactly, and one `models`
row per model. Add them to `CATALOGUE` in [scripts/seed.ts](../../scripts/seed.ts),
or through `/admin/providers` and `/admin/models` at runtime.

A model is offered to a user only when **all three** hold: the model is enabled,
its provider is enabled, and an adapter is registered for that provider name. A
models row naming an unregistered provider is skipped silently by
`listAvailableModels()` — but `getAdapter()` **throws** if a request somehow
reaches it, so a misconfiguration surfaces loudly instead of as a chat that
quietly does nothing.

### 5. Set the key and prove it works

Paste the key in `/admin/providers` (it is encrypted with AES-256-GCM before it
touches the database), press **Test connection** — which performs a real
one-token generation, not an auth check — then run:

```bash
npm run verify:providers
```

That suite greps the tree to prove no vendor SDK import and no provider name
escaped this directory, and then streams a real completion through every
registered adapter. Two providers working is not the same as an abstraction
working: an `if/else` in the chat route would pass a "both providers stream"
test and fail this one.

## What lives where

| File | Responsibility |
|---|---|
| [types.ts](types.ts) | The contract: `ChatProvider`, message/event shapes, `ProviderError` |
| [anthropic.ts](anthropic.ts) | Anthropic adapter — the only file that knows Anthropic's API |
| [openai.ts](openai.ts) | OpenAI adapter — the only file that knows OpenAI's API |
| [openai-compatible.ts](openai-compatible.ts) | Shared body for providers that speak OpenAI's format at another base URL |
| [groq.ts](groq.ts) | Groq — configuration over `openai-compatible.ts` |
| [perplexity.ts](perplexity.ts) | Perplexity — configuration over `openai-compatible.ts` |
| [registry.ts](registry.ts) | Name → adapter map, and DB rows → `ResolvedModel` |

### If the provider is OpenAI-compatible

Most new providers are. Do **not** copy `openai.ts` — build on
`openai-compatible.ts`, which holds the stream parsing, usage extraction and
abort handling once:

```ts
export function createMistralProvider(apiKey: string): ChatProvider {
  return createOpenAICompatibleProvider(apiKey, {
    name: MISTRAL_PROVIDER_NAME,
    label: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    probeModel: '…',                     // cheapest; validateKey generates with it
    models: { source: 'endpoint' },      // or { source: 'static', list: [...] }
  });
}
```

"OpenAI-compatible" is a claim rather than a guarantee, and the config exposes
exactly the parts that are not: `outputTokenParam` (OpenAI renamed `max_tokens`
to `max_completion_tokens`; some took the new name, some reject it),
`requestUsageInStream` (providers that always send usage may reject the
parameter and fail every request), and whether `GET /models` exists at all.

`openai.ts` deliberately does not use it: it is the reference implementation and
carries OpenAI-specific handling that would be noise in the shared file.

### Test it without a key

`npm run verify:adapters` stands a fake provider on localhost and makes it
return 401, 403, 402, 429, `insufficient_quota`, a context-length rejection and
a 500. Those are the paths a working key cannot reach, and they are where a new
adapter is most likely to be wrong. It needs no credential and costs nothing.

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
