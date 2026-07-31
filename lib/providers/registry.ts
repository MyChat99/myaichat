import 'server-only';

import { createAdminClient } from '@/lib/db/admin';

import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { ProviderError, type ChatProvider } from './types';

/**
 * Maps `providers.name` rows to adapter instances.
 *
 * THIS OBJECT IS THE ONLY PLACE A PROVIDER NAME APPEARS OUTSIDE ITS ADAPTER.
 * Adding a provider = write the adapter, add one line here, insert the DB rows.
 * Nothing in /app, /components, or the route handler changes.
 */
const ADAPTERS: Record<string, ChatProvider> = {
  [anthropicProvider.name]: anthropicProvider,
  [openaiProvider.name]: openaiProvider,
};

/** A model row joined to its provider, ready to route a request. */
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
};

export function getAdapter(providerName: string): ChatProvider {
  const adapter = ADAPTERS[providerName];
  if (!adapter) {
    // A models row pointing at a provider with no adapter is a config error,
    // not a user error — fail loudly rather than silently skipping the model.
    throw new ProviderError('provider', `No adapter registered for "${providerName}".`, false);
  }
  return adapter;
}

export function registeredProviderNames(): string[] {
  return Object.keys(ADAPTERS);
}

/** Every enabled model whose provider is also enabled AND has an adapter. */
export async function listAvailableModels(): Promise<ResolvedModel[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('models')
    .select(
      'id, model_id, display_name, max_tokens, input_cost_per_1k, output_cost_per_1k, providers!inner(name, enabled)',
    )
    .eq('enabled', true)
    .eq('providers.enabled', true)
    .order('display_name');

  if (error) throw new ProviderError('provider', 'Could not load models.', true);

  type Row = (typeof data)[number] & { providers: { name: string; enabled: boolean } };

  return (data as Row[])
    .filter((row) => ADAPTERS[row.providers.name] !== undefined)
    .map((row) => ({
      id: row.id,
      modelId: row.model_id,
      displayName: row.display_name,
      maxTokens: row.max_tokens,
      inputCostPer1k: Number(row.input_cost_per_1k),
      outputCostPer1k: Number(row.output_cost_per_1k),
      providerName: row.providers.name,
    }));
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
