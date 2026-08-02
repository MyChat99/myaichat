import 'server-only';

import { createOpenAICompatibleProvider } from './openai-compatible';
import type { ChatProvider } from './types';

/**
 * Groq adapter.
 *
 * Groq serves open-weight models on its own inference hardware behind an
 * OpenAI-compatible API, so this file is configuration rather than a second
 * implementation of the same wire format — see openai-compatible.ts for the
 * parts that genuinely differ between such providers.
 *
 * Model ids, context windows and prices were taken from
 * https://console.groq.com/docs/models and https://groq.com/pricing on
 * 2026-08-02, not from memory. Groq exposes `GET /openai/v1/models`, so the
 * admin panel lists live rather than from the copy seeded below.
 */

export const GROQ_PROVIDER_NAME = 'groq';

/**
 * Ids that are chat models, filtered from the live listing.
 *
 * Groq's catalogue also carries speech, transcription and guard models, which
 * are real entries that would appear in a model picker and fail on first use.
 */
const NON_CHAT = /whisper|tts|guard|embed|distil|playai/i;

export function createGroqProvider(apiKey: string): ChatProvider {
  return createOpenAICompatibleProvider(apiKey, {
    name: GROQ_PROVIDER_NAME,
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',

    // The smallest production model, because this runs on every admin
    // dashboard render that misses the health cache.
    probeModel: 'llama-3.1-8b-instant',

    models: { source: 'endpoint', include: (id) => !NON_CHAT.test(id) },
  });
}
