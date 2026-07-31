import { createAdminClient } from '@/lib/db/admin';
import { requireAdmin } from '@/lib/security/auth';

import { ModelsManager, type AdminModel, type ProviderOption } from './models-client';

export default async function ModelsPage() {
  await requireAdmin();

  const db = createAdminClient();

  const [{ data: providers }, { data: models }] = await Promise.all([
    db.from('providers').select('id, name, enabled').order('name'),
    db
      .from('models')
      .select(
        'id, provider_id, model_id, display_name, max_tokens, default_temperature, input_cost_per_1k, output_cost_per_1k, enabled',
      )
      .order('display_name'),
  ]);

  const providerOptions: ProviderOption[] = (providers ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    enabled: p.enabled,
  }));

  const adminModels: AdminModel[] = (models ?? []).map((m) => ({
    id: m.id,
    providerId: m.provider_id,
    modelId: m.model_id,
    displayName: m.display_name,
    maxTokens: m.max_tokens,
    defaultTemperature: Number(m.default_temperature),
    inputCostPer1k: Number(m.input_cost_per_1k),
    outputCostPer1k: Number(m.output_cost_per_1k),
    enabled: m.enabled,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Models</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Only enabled models on enabled providers appear in the chat selector. Costs are per 1K
          tokens and drive the usage estimates.
        </p>
      </header>

      <ModelsManager providers={providerOptions} models={adminModels} />
    </div>
  );
}
