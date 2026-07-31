'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { updateSettings } from '@/app/(app)/admin/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Settings = {
  global_system_prompt: string;
  rate_limit_messages_per_hour: number;
  max_upload_size_mb: number;
  signups_enabled: boolean;
  default_model_id: string | null;
};

export function SettingsForm({
  initial,
  models,
}: {
  initial: Settings;
  models: { id: string; label: string }[];
}) {
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await updateSettings(form);
        toast.success('Settings saved.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save settings.');
      }
    });
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="defaultModel">Default model</Label>
        <select
          id="defaultModel"
          value={form.default_model_id ?? ''}
          onChange={(e) => setForm({ ...form, default_model_id: e.target.value || null })}
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
        >
          <option value="">— none —</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Used for new conversations when the user has not chosen one.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="systemPrompt">Global system prompt</Label>
        <textarea
          id="systemPrompt"
          rows={4}
          value={form.global_system_prompt}
          onChange={(e) => setForm({ ...form, global_system_prompt: e.target.value })}
          placeholder="Optional. Prepended to every conversation."
          className="border-input bg-background w-full resize-y rounded-md border p-2 text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rateLimit">Messages per hour, per user</Label>
          <Input
            id="rateLimit"
            type="number"
            min={1}
            value={form.rate_limit_messages_per_hour}
            onChange={(e) =>
              setForm({ ...form, rate_limit_messages_per_hour: Number(e.target.value) })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="maxUpload">Max upload size (MB)</Label>
          <Input
            id="maxUpload"
            type="number"
            min={1}
            value={form.max_upload_size_mb}
            onChange={(e) => setForm({ ...form, max_upload_size_mb: Number(e.target.value) })}
          />
          <p className="text-muted-foreground text-xs">Takes effect with uploads in Phase 6.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="signups"
          checked={form.signups_enabled}
          onCheckedChange={(v) => setForm({ ...form, signups_enabled: v })}
        />
        <Label htmlFor="signups">Allow new sign-ups</Label>
      </div>

      <Button type="button" disabled={pending} onClick={save}>
        Save settings
      </Button>
    </div>
  );
}
