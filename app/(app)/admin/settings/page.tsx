import { createAdminClient } from '@/lib/db/admin';
import { listAvailableModels } from '@/lib/providers/registry';
import { requireAdmin } from '@/lib/security/auth';
import { DEFAULT_CEILING_USD } from '@/lib/security/spend-ceiling';

import { SettingsForm } from './settings-form';

function readSetting<T>(rows: { key: string; value: unknown }[], key: string, fallback: T): T {
  const row = rows.find((r) => r.key === key);
  return (row?.value as T) ?? fallback;
}

export default async function SettingsPage() {
  await requireAdmin();

  const db = createAdminClient();
  const [{ data: settings }, models] = await Promise.all([
    db.from('system_settings').select('key, value'),
    listAvailableModels(),
  ]);

  const rows = settings ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Applies to every user. The rate limit is enforced per user per rolling hour.
        </p>
      </header>

      <SettingsForm
        initial={{
          global_system_prompt: readSetting(rows, 'global_system_prompt', ''),
          rate_limit_messages_per_hour: readSetting(rows, 'rate_limit_messages_per_hour', 60),
          max_upload_size_mb: readSetting(rows, 'max_upload_size_mb', 20),
          daily_token_budget_per_user: readSetting(rows, 'daily_token_budget_per_user', 0),
          session_idle_timeout_minutes: readSetting(rows, 'session_idle_timeout_minutes', 0),
          signups_enabled: readSetting(rows, 'signups_enabled', true),
          signup_allowed_domains: readSetting(rows, 'signup_allowed_domains', ''),
          monthly_spend_ceiling_usd: readSetting(
            rows,
            'monthly_spend_ceiling_usd',
            DEFAULT_CEILING_USD,
          ),
          default_model_id: readSetting<string | null>(rows, 'default_model_id', null),
        }}
        models={models.map((m) => ({ id: m.id, label: `${m.displayName} (${m.providerName})` }))}
        defaultCeilingUsd={DEFAULT_CEILING_USD}
      />
    </div>
  );
}
