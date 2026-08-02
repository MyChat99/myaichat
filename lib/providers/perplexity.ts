import 'server-only';

import { createOpenAICompatibleProvider } from './openai-compatible';
import type { ChatProvider } from './types';

/**
 * Perplexity adapter.
 *
 * Perplexity's Sonar models are search-grounded: they answer from live web
 * results rather than from weights alone, which is the reason to have them here
 * alongside three providers that do not. Its API is OpenAI-compatible via a
 * base URL change, so this is configuration.
 *
 * Two deviations from the OpenAI defaults, both deliberate:
 *
 *  - `max_tokens`, not `max_completion_tokens`. The rename is OpenAI's own and
 *    Perplexity's documented parameter is the original.
 *  - no `stream_options.include_usage`. That parameter is an OpenAI extension
 *    for a behaviour Perplexity does not share; sending it risks a rejected
 *    request, and the cost of leaving it off is a usage count that may be zero
 *    rather than a conversation that fails.
 *
 * Model ids and prices were taken from docs.perplexity.ai on 2026-08-02. There
 * is no `GET /models` endpoint, so the list below is the documented one — which
 * is exactly why `listModels()` supports a static source.
 */

export const PERPLEXITY_PROVIDER_NAME = 'perplexity';

/**
 * `sonar-deep-research` is deliberately absent.
 *
 * It runs exhaustive multi-search investigations that take minutes rather than
 * seconds, and bills separately for citation tokens, reasoning tokens and per-
 * search fees — none of which this app's cost model records. Offering it in a
 * chat picker would produce requests that look hung and spend that analytics
 * would under-report. It can still be added by hand in /admin/models.
 */
const DOCUMENTED_MODELS = [
  { id: 'sonar', displayName: 'Sonar' },
  { id: 'sonar-pro', displayName: 'Sonar Pro' },
  { id: 'sonar-reasoning-pro', displayName: 'Sonar Reasoning Pro' },
];

export function createPerplexityProvider(apiKey: string): ChatProvider {
  return createOpenAICompatibleProvider(apiKey, {
    name: PERPLEXITY_PROVIDER_NAME,
    label: 'Perplexity',
    baseURL: 'https://api.perplexity.ai',

    probeModel: 'sonar',
    outputTokenParam: 'max_tokens',
    requestUsageInStream: false,

    models: { source: 'static', list: DOCUMENTED_MODELS },
  });
}
