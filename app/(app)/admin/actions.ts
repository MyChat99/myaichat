'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/db/admin';
import { getAdapter, isRegisteredProvider } from '@/lib/providers/registry';
import { ProviderError } from '@/lib/providers/types';
import { auditLog, redactMetadata } from '@/lib/security/audit';
import { requireAdmin } from '@/lib/security/auth';
import { encryptSecret, keyLast4 } from '@/lib/security/crypto';
import { ReauthError, requireAdminWithPassword } from '@/lib/security/reauth';

/**
 * Admin mutations.
 *
 * Every export here starts with `requireAdmin()` and ends with `auditLog()`.
 * These are Server Actions, so Next verifies the Origin header before the body
 * runs — that is the CSRF control, and it is why no admin mutation is exposed
 * as a plain route handler.
 *
 * Writes use the admin client because admin work legitimately spans other
 * users' rows; the `requireAdmin()` gate is what authorises it.
 */

/**
 * Re-auth failures are RETURNED, not thrown. In production Next replaces a
 * thrown Server Action error with a generic message, so "that password is not
 * correct" would reach the user as "an error occurred" — unusable for a prompt
 * whose whole job is to tell you that you mistyped. Genuine server faults still
 * throw, because there the generic message is the right one.
 */
export type KeyActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();
const providerName = z.string().trim().min(1).max(64);

// ---------------------------------------------------------------- providers

/**
 * Writing or replacing a provider key is the highest-value action in this app —
 * the key it overwrites is the one that bills a real account — so it is the one
 * place that asks for the password again rather than trusting the session. See
 * lib/security/reauth.ts for why the check is server-side and throttled.
 */
export async function setProviderKey(
  name: string,
  apiKey: string,
  password: string,
): Promise<KeyActionResult> {
  let admin;
  try {
    admin = await requireAdminWithPassword(password, await headers());
  } catch (err) {
    if (err instanceof ReauthError) return { ok: false, error: err.message };
    throw err;
  }

  const parsedName = providerName.parse(name);
  const parsedKey = z.string().trim().min(8).max(500).parse(apiKey);

  if (!isRegisteredProvider(parsedName)) {
    throw new Error(`No adapter is registered for "${parsedName}".`);
  }

  const db = createAdminClient();
  const { error } = await db
    .from('providers')
    .update({
      encrypted_api_key: encryptSecret(parsedKey),
      key_last4: keyLast4(parsedKey),
    })
    .eq('name', parsedName);

  if (error) throw new Error('Could not save the key.');

  await auditLog({
    actorId: admin.id,
    action: 'provider.key_set',
    targetType: 'provider',
    targetId: parsedName,
    // last4 only — the key itself must never reach the audit trail.
    metadata: redactMetadata({ last4: keyLast4(parsedKey) }),
  });

  revalidatePath('/admin/providers');
  return { ok: true };
}

/** Deleting a key also disables the provider for every user, so it re-authenticates too. */
export async function deleteProviderKey(name: string, password: string): Promise<KeyActionResult> {
  let admin;
  try {
    admin = await requireAdminWithPassword(password, await headers());
  } catch (err) {
    if (err instanceof ReauthError) return { ok: false, error: err.message };
    throw err;
  }

  const parsedName = providerName.parse(name);

  const db = createAdminClient();
  const { error } = await db
    .from('providers')
    .update({ encrypted_api_key: null, key_last4: null, enabled: false })
    .eq('name', parsedName);

  if (error) throw new Error('Could not delete the key.');

  await auditLog({
    actorId: admin.id,
    action: 'provider.key_deleted',
    targetType: 'provider',
    targetId: parsedName,
  });

  revalidatePath('/admin/providers');
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function toggleProvider(name: string, enabled: boolean) {
  const admin = await requireAdmin();
  const parsedName = providerName.parse(name);

  const db = createAdminClient();
  const { error } = await db.from('providers').update({ enabled }).eq('name', parsedName);

  if (error) throw new Error('Could not update the provider.');

  await auditLog({
    actorId: admin.id,
    action: 'provider.toggled',
    targetType: 'provider',
    targetId: parsedName,
    metadata: { enabled },
  });

  // Disabling a provider must remove its models from every user's selector.
  revalidatePath('/admin/providers');
  revalidatePath('/', 'layout');
}

export type ConnectionTest = {
  ok: boolean;
  message: string;
  latencyMs: number | null;
};

/**
 * Test Connection.
 *
 * Delegates to the adapter's `validateKey()`, which performs a real (tiny)
 * generation — an unfunded key authenticates and lists models perfectly well,
 * so anything less would show a green tick on a key that cannot work
 * (DECISIONS.md DEC-011).
 */
export async function testProviderConnection(name: string): Promise<ConnectionTest> {
  await requireAdmin();
  const parsedName = providerName.parse(name);

  try {
    const adapter = await getAdapter(parsedName);
    const result = await adapter.validateKey();

    return {
      ok: result.valid,
      message: result.valid ? 'Key is valid and can generate.' : (result.reason ?? 'Key rejected.'),
      latencyMs: result.latencyMs ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof ProviderError ? err.message : 'Could not reach the provider.',
      latencyMs: null,
    };
  }
}

// ---------------------------------------------------------------- models

const modelInput = z.object({
  providerId: uuid,
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  maxTokens: z.coerce.number().int().positive().max(1_000_000),
  defaultTemperature: z.coerce.number().min(0).max(2),
  inputCostPer1k: z.coerce.number().min(0),
  outputCostPer1k: z.coerce.number().min(0),
  enabled: z.boolean(),
});

export async function upsertModel(input: unknown, existingId?: string) {
  const admin = await requireAdmin();
  const parsed = modelInput.parse(input);

  const db = createAdminClient();
  const row = {
    provider_id: parsed.providerId,
    model_id: parsed.modelId,
    display_name: parsed.displayName,
    max_tokens: parsed.maxTokens,
    default_temperature: parsed.defaultTemperature,
    input_cost_per_1k: parsed.inputCostPer1k,
    output_cost_per_1k: parsed.outputCostPer1k,
    enabled: parsed.enabled,
  };

  const { data, error } = existingId
    ? await db.from('models').update(row).eq('id', uuid.parse(existingId)).select('id').single()
    : await db
        .from('models')
        .upsert(row, { onConflict: 'provider_id,model_id' })
        .select('id')
        .single();

  if (error) throw new Error('Could not save the model.');

  await auditLog({
    actorId: admin.id,
    action: existingId ? 'model.updated' : 'model.created',
    targetType: 'model',
    targetId: data.id,
    metadata: { model_id: parsed.modelId, enabled: parsed.enabled },
  });

  revalidatePath('/admin/models');
  revalidatePath('/', 'layout');
}

export async function deleteModel(id: string) {
  const admin = await requireAdmin();
  const parsedId = uuid.parse(id);

  const db = createAdminClient();
  const { data: model } = await db.from('models').select('model_id').eq('id', parsedId).single();

  const { error } = await db.from('models').delete().eq('id', parsedId);
  if (error) throw new Error('Could not delete the model.');

  await auditLog({
    actorId: admin.id,
    action: 'model.deleted',
    targetType: 'model',
    targetId: parsedId,
    metadata: { model_id: model?.model_id },
  });

  revalidatePath('/admin/models');
  revalidatePath('/', 'layout');
}

/** Live model list from the provider, for the "Fetch from provider" button. */
export async function fetchProviderModels(name: string) {
  await requireAdmin();
  const parsedName = providerName.parse(name);

  try {
    const adapter = await getAdapter(parsedName);
    return { ok: true as const, models: await adapter.listModels() };
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof ProviderError ? err.message : 'Could not fetch models.',
    };
  }
}

// ---------------------------------------------------------------- users

export async function setUserRole(userId: string, role: 'user' | 'admin') {
  const admin = await requireAdmin();
  const parsedId = uuid.parse(userId);
  const parsedRole = z.enum(['user', 'admin']).parse(role);

  // Refuse to strip your own admin rights — that can lock everyone out of
  // /admin with no way back except the seed script.
  if (parsedId === admin.id && parsedRole !== 'admin') {
    throw new Error('You cannot remove your own admin role.');
  }

  const db = createAdminClient();
  const { error } = await db.from('profiles').update({ role: parsedRole }).eq('id', parsedId);
  if (error) throw new Error('Could not change the role.');

  await auditLog({
    actorId: admin.id,
    action: 'user.role_changed',
    targetType: 'user',
    targetId: parsedId,
    metadata: { role: parsedRole },
  });

  revalidatePath('/admin/users');
}

export async function setUserSuspended(userId: string, suspended: boolean) {
  const admin = await requireAdmin();
  const parsedId = uuid.parse(userId);

  if (parsedId === admin.id && suspended) {
    throw new Error('You cannot suspend yourself.');
  }

  const db = createAdminClient();
  const { error } = await db.from('profiles').update({ suspended }).eq('id', parsedId);
  if (error) throw new Error('Could not change the suspension.');

  await auditLog({
    actorId: admin.id,
    action: 'user.suspension_changed',
    targetType: 'user',
    targetId: parsedId,
    metadata: { suspended },
  });

  revalidatePath('/admin/users');
}

// ---------------------------------------------------------------- settings

const settingsInput = z.object({
  global_system_prompt: z.string().max(10_000),
  rate_limit_messages_per_hour: z.coerce.number().int().min(1).max(10_000),
  max_upload_size_mb: z.coerce.number().int().min(1).max(1024),
  // 0 = unlimited. Enforced in the chat route (lib/security/token-budget.ts).
  daily_token_budget_per_user: z.coerce.number().int().min(0).max(100_000_000),
  // 0 = disabled. Capped at a week — beyond that it is not an idle policy.
  session_idle_timeout_minutes: z.coerce.number().int().min(0).max(10_080),
  signups_enabled: z.boolean(),
  default_model_id: z.string().uuid().nullable().optional(),
});

export async function updateSettings(input: unknown) {
  const admin = await requireAdmin();
  const parsed = settingsInput.parse(input);

  const db = createAdminClient();

  // `system_settings.value` is jsonb NOT NULL — a JS null becomes SQL NULL and
  // violates the constraint, so a null default model is simply not written
  // (ISSUES.md ISSUE-008).
  const rows = Object.entries(parsed)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value: value as never, updated_by: admin.id }));

  const { error } = await db.from('system_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error('Could not save settings.');

  await auditLog({
    actorId: admin.id,
    action: 'settings.updated',
    targetType: 'system_settings',
    metadata: redactMetadata({ keys: rows.map((r) => r.key) }),
  });

  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
}
