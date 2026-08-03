import 'server-only';

import { createOpenAICompatibleProvider } from './openai-compatible';
import type { ChatProvider } from './types';

/**
 * Cerebras adapter.
 *
 * Cerebras serves open-weight models on its own wafer-scale hardware behind an
 * OpenAI-compatible API, so this file is configuration rather than a second
 * implementation of the wire format — see openai-compatible.ts.
 *
 * Read from https://inference-docs.cerebras.ai on 2026-08-03, not from memory:
 *
 *  - base URL `https://api.cerebras.ai/v1`
 *  - the output cap is `max_completion_tokens`, which is this module's default
 *  - `GET /v1/models` exists, so the catalogue is listed live
 *
 * ## No model id is hardcoded, deliberately
 *
 * Cerebras changes its catalogue without notice, so both places a model id
 * could be pinned are resolved at runtime instead:
 *
 *  - the admin panel lists from `GET /v1/models`
 *  - `probeModel` is a FUNCTION over that listing, so the health check follows
 *    the catalogue. A pinned id would start reporting "the key is bad" the day
 *    the vendor retired that model, which is the wrong thing to tell an
 *    operator whose key is fine.
 *
 * ## ⚠️ Token counts are not collected from streams
 *
 * `stream_options.include_usage` is **not documented** by Cerebras either way.
 * Sending an unsupported parameter fails the whole request, while omitting it
 * only loses a token count — so it is omitted until someone can test it against
 * a real key. The consequence is real and must not be glossed: streamed
 * Cerebras turns record ZERO tokens, so they contribute nothing to the monthly
 * spend ceiling or per-user budgets.
 *
 * That is acceptable for a prepaid free-credit tier and NOT acceptable for a
 * card-backed one. See ISSUE-069 for how to test and flip it.
 */

export const CEREBRAS_PROVIDER_NAME = 'cerebras';

/**
 * Entries in the listing that are not chat models.
 *
 * Cerebras' catalogue is small today, but the listing is the vendor's and a
 * speech or embedding entry appearing in a model picker fails on first use.
 */
const NON_CHAT = /whisper|tts|guard|embed|rerank|moderation/i;

/**
 * Prefer the smallest model for the health probe.
 *
 * The probe runs on every admin dashboard render that misses the health cache,
 * so it should be the cheapest thing that proves the key can generate. Model
 * names carry their parameter count (`gpt-oss-120b`, `gemma-4-31b`), so the
 * smallest number wins; anything unparseable sorts last but is still usable,
 * which keeps this working if the naming convention changes.
 */
function smallestFirst(id: string): number {
  const billions = /(\d+(?:\.\d+)?)\s*b\b/i.exec(id);
  return billions ? Number(billions[1]) : Number.POSITIVE_INFINITY;
}

export function createCerebrasProvider(apiKey: string): ChatProvider {
  return createOpenAICompatibleProvider(apiKey, {
    name: CEREBRAS_PROVIDER_NAME,
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',

    probeModel: (listed) =>
      [...listed].sort((a, b) => smallestFirst(a.id) - smallestFirst(b.id))[0]?.id,

    // Undocumented; omitted rather than risked. See the note above.
    requestUsageInStream: false,

    models: { source: 'endpoint', include: (id) => !NON_CHAT.test(id) },
  });
}
