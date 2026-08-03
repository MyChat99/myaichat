import 'server-only';

import { createAdminClient } from '@/lib/db/admin';
import { decryptSecret } from '@/lib/security/crypto';

import { ANTHROPIC_PROVIDER_NAME, createAnthropicProvider } from './anthropic';
import { GROQ_PROVIDER_NAME, createGroqProvider } from './groq';
import { OPENAI_PROVIDER_NAME, createOpenAIProvider } from './openai';
import { PERPLEXITY_PROVIDER_NAME, createPerplexityProvider } from './perplexity';
import { ProviderError, type ChatProvider } from './types';
import type { PricedModel } from '@/lib/theme/compare-cost';

/**
 * Maps `providers.name` rows to adapter factories.
 *
 * THIS OBJECT IS THE ONLY PLACE A PROVIDER NAME APPEARS OUTSIDE ITS ADAPTER.
 * Adding a provider = write the adapter, add one line here, insert the DB rows.
 * Nothing in /app, /components, or the route handler changes.
 *
 * Factories rather than instances because the API key now comes from the
 * encrypted database column and can be rotated while the app is running.
 */
const ADAPTERS: Record<string, (apiKey: string) => ChatProvider> = {
  [ANTHROPIC_PROVIDER_NAME]: createAnthropicProvider,
  [OPENAI_PROVIDER_NAME]: createOpenAIProvider,
  [GROQ_PROVIDER_NAME]: createGroqProvider,
  [PERPLEXITY_PROVIDER_NAME]: createPerplexityProvider,
};

/**
 * Env var fallback, for local development only.
 *
 * Phase 4 moves keys into `providers.encrypted_api_key`. This map keeps a
 * freshly-cloned checkout working before anyone opens the admin panel — the
 * DB value always wins when present.
 */
const ENV_FALLBACK: Record<string, string | undefined> = {
  [ANTHROPIC_PROVIDER_NAME]: 'ANTHROPIC_API_KEY',
  [OPENAI_PROVIDER_NAME]: 'OPENAI_API_KEY',
  [GROQ_PROVIDER_NAME]: 'GROQ_API_KEY',
  [PERPLEXITY_PROVIDER_NAME]: 'PERPLEXITY_API_KEY',
};

export type ResolvedModel = {
  /** `models.id` — the DB uuid stored on the conversation. */
  id: string;
  /** The provider's own model identifier. */
  modelId: string;
  displayName: string;
  maxTokens: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  providerName: string;
  supportsVision: boolean;
  supportsDocuments: boolean;
};

export function registeredProviderNames(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * Whether a provider has a key from either source.
 *
 * Presence only — this deliberately never decrypts, so it is safe to call while
 * building a list. Whether the key WORKS is a different question, answered by
 * `validateKey()` and the admin panel's Test connection.
 */
function hasUsableKey(name: string, keyLast4: string | null): boolean {
  if (keyLast4) return true;
  const envVar = ENV_FALLBACK[name];
  return Boolean(envVar && process.env[envVar]);
}

/** Provider names that are registered AND hold a key. */
export async function configuredProviderNames(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from('providers').select('name, key_last4');
  return (data ?? [])
    .filter((row) => ADAPTERS[row.name] !== undefined)
    .filter((row) => hasUsableKey(row.name, row.key_last4))
    .map((row) => row.name);
}

export function isRegisteredProvider(name: string): boolean {
  return ADAPTERS[name] !== undefined;
}

/**
 * Decrypted key for a provider: database first, env var second.
 *
 * Decryption happens here and nowhere else on the read path, so the plaintext
 * key exists only inside the adapter instance it is handed to.
 */
export async function getProviderKey(providerName: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('providers')
    .select('encrypted_api_key, enabled')
    .eq('name', providerName)
    .maybeSingle();

  if (data?.enabled === false) return null;

  if (data?.encrypted_api_key) {
    try {
      return decryptSecret(data.encrypted_api_key);
    } catch (err) {
      // A stored key we cannot decrypt means the master key changed. Say so
      // rather than silently falling back to a stale env var.
      console.error(`[registry] could not decrypt the key for "${providerName}":`, err);
      throw new ProviderError(
        'auth',
        `The stored key for ${providerName} could not be decrypted. Re-enter it in the admin panel.`,
        false,
      );
    }
  }

  const envName = ENV_FALLBACK[providerName];
  return envName ? (process.env[envName] ?? null) : null;
}

/** A configured adapter for a provider, with its key already injected. */
export async function getAdapter(providerName: string): Promise<ChatProvider> {
  const factory = ADAPTERS[providerName];
  if (!factory) {
    // A models row pointing at a provider with no adapter is a config error,
    // not a user error — fail loudly rather than silently skipping the model.
    throw new ProviderError('provider', `No adapter registered for "${providerName}".`, false);
  }

  const apiKey = await getProviderKey(providerName);
  if (!apiKey) {
    throw new ProviderError('auth', `${providerName} has no API key configured.`, false);
  }

  return factory(apiKey);
}

/** Every enabled model whose provider is also enabled AND has an adapter. */
export async function listAvailableModels(): Promise<ResolvedModel[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('models')
    .select(
      'id, model_id, display_name, max_tokens, input_cost_per_1k, output_cost_per_1k, supports_vision, supports_documents, providers!inner(name, enabled, key_last4)',
    )
    .eq('enabled', true)
    .eq('providers.enabled', true)
    .order('display_name');

  if (error) throw new ProviderError('provider', 'Could not load models.', true);

  type Row = (typeof data)[number] & {
    providers: { name: string; enabled: boolean; key_last4: string | null };
  };

  return (
    (data as Row[])
      .filter((row) => ADAPTERS[row.providers.name] !== undefined)
      /**
       * A model is only OFFERED if its provider can actually be called.
       *
       * Registering an adapter and seeding its models is not the same as having
       * paid for the service. Without this, a freshly-seeded deployment lists
       * every model of every provider it has no key for: the picker offers them,
       * the empty state counts them ("11 models are inked and ready" when four
       * were), and choosing one fails at send with an error the user cannot act
       * on — `getAdapter()` throws by design, but by then the user has typed a
       * message and waited.
       *
       * `key_last4` is written and cleared with the key itself, so it is an exact
       * presence test that never brings ciphertext into memory. The env fallback
       * still counts, because a fresh checkout with keys in `.env.local` and
       * nothing in the admin panel is a supported way to run this.
       */
      .filter((row) => hasUsableKey(row.providers.name, row.providers.key_last4))
      .map((row) => ({
        id: row.id,
        modelId: row.model_id,
        displayName: row.display_name,
        maxTokens: row.max_tokens,
        inputCostPer1k: Number(row.input_cost_per_1k),
        outputCostPer1k: Number(row.output_cost_per_1k),
        providerName: row.providers.name,
        supportsVision: row.supports_vision,
        supportsDocuments: row.supports_documents,
      }))
  );
}

/** Resolves one model by its DB id, or null when it is missing or disabled. */
export async function resolveModel(modelDbId: string): Promise<ResolvedModel | null> {
  const models = await listAvailableModels();
  return models.find((m) => m.id === modelDbId) ?? null;
}

/** Fallback when a conversation has no model pinned yet. */
export async function defaultModel(): Promise<ResolvedModel | null> {
  const models = await listAvailableModels();
  return models[0] ?? null;
}

/**
 * The models a user could have picked, shaped for the cost comparison.
 *
 * Derived from `listAvailableModels()` rather than read from the database
 * again: it was a second query against the same table on every page render, and
 * two independently-filtered lists of "models you could have used" can disagree
 * — the comparison would then price a model the picker never offered.
 *
 * Prices come straight through. `models.input_cost_per_1k` is
 * `not null default 0`, so a model nobody priced arrives as 0 rather than null,
 * and `compareCost` is what decides that both-zero means "no price set".
 */
export function toPricedModels(models: ResolvedModel[]): PricedModel[] {
  return models
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      providerName: m.providerName,
      inputCostPer1k: m.inputCostPer1k,
      outputCostPer1k: m.outputCostPer1k,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
