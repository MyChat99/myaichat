'use client';

import { Download, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteModel, fetchProviderModels, upsertModel } from '@/app/(app)/admin/actions';
import { ProviderLogo } from '@/components/chat/provider-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export type ProviderOption = { id: string; name: string; enabled: boolean };

export type AdminModel = {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  maxTokens: number;
  defaultTemperature: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  enabled: boolean;
};

type Draft = Omit<AdminModel, 'id'> & { id?: string };

function emptyDraft(providerId: string): Draft {
  return {
    providerId,
    modelId: '',
    displayName: '',
    maxTokens: 8192,
    defaultTemperature: 1,
    inputCostPer1k: 0,
    outputCostPer1k: 0,
    enabled: true,
  };
}

function ModelForm({
  draft,
  providers,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  providers: ProviderOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await upsertModel(
          {
            providerId: form.providerId,
            modelId: form.modelId,
            displayName: form.displayName,
            maxTokens: form.maxTokens,
            defaultTemperature: form.defaultTemperature,
            inputCostPer1k: form.inputCostPer1k,
            outputCostPer1k: form.outputCostPer1k,
            enabled: form.enabled,
          },
          form.id,
        );
        toast.success(form.id ? 'Model updated.' : 'Model created.');
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the model.');
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <select
              id="provider"
              value={form.providerId}
              onChange={(e) => setForm({ ...form, providerId: e.target.value })}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.enabled ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="modelId">Model ID</Label>
            <Input
              id="modelId"
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              placeholder="claude-opus-5"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="Claude Opus 5"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="maxTokens">Max output tokens</Label>
            <Input
              id="maxTokens"
              type="number"
              min={1}
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inputCost">Input cost / 1K</Label>
            <Input
              id="inputCost"
              type="number"
              step="0.000001"
              min={0}
              value={form.inputCostPer1k}
              onChange={(e) => setForm({ ...form, inputCostPer1k: Number(e.target.value) })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="outputCost">Output cost / 1K</Label>
            <Input
              id="outputCost"
              type="number"
              step="0.000001"
              min={0}
              value={form.outputCostPer1k}
              onChange={(e) => setForm({ ...form, outputCostPer1k: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Switch
            id="enabled"
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
          <Label htmlFor="enabled">Enabled</Label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || !form.modelId.trim() || !form.displayName.trim()}
            onClick={save}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ModelsManager({
  providers,
  models,
}: {
  providers: ProviderOption[];
  models: AdminModel[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();

  const byProvider = providers.map((provider) => ({
    provider,
    models: models.filter((m) => m.providerId === provider.id),
  }));

  function fetchModels(provider: ProviderOption) {
    startTransition(async () => {
      const result = await fetchProviderModels(provider.name);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      // Deliberately not auto-inserting: the provider's catalogue includes
      // models with wildly different costs and limits, and we have no cost data
      // for them. Listing them lets an admin add one with real numbers.
      toast.success(
        `${result.models.length} models available: ${result.models
          .slice(0, 4)
          .map((m) => m.id)
          .join(', ')}${result.models.length > 4 ? '…' : ''}`,
        { duration: 10_000 },
      );
    });
  }

  return (
    <div className="space-y-6">
      {draft ? (
        <ModelForm
          draft={draft}
          providers={providers}
          onCancel={() => setDraft(null)}
          onSaved={() => setDraft(null)}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={providers.length === 0}
          onClick={() => setDraft(emptyDraft(providers[0]?.id ?? ''))}
        >
          <Plus className="mr-1 size-4" />
          Add model
        </Button>
      )}

      {byProvider.map(({ provider, models: providerModels }) => (
        <section key={provider.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ProviderLogo provider={provider.name} />
              {provider.name}
              {!provider.enabled ? (
                <span className="text-muted-foreground text-xs">(disabled)</span>
              ) : null}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => fetchModels(provider)}
            >
              <Download className="mr-1 size-3.5" />
              Fetch from provider
            </Button>
          </div>

          {providerModels.length === 0 ? (
            <p className="text-muted-foreground text-xs">No models.</p>
          ) : (
            <div className="divide-border overflow-hidden rounded-lg border">
              {providerModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{model.displayName}</p>
                    <p className="text-muted-foreground truncate font-mono text-xs">
                      {model.modelId} · {model.maxTokens} max · ${model.inputCostPer1k}/$
                      {model.outputCostPer1k} per 1K
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {model.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDraft({ ...model })}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Delete ${model.displayName}`}
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Delete ${model.displayName}?`)) return;
                        startTransition(async () => {
                          try {
                            await deleteModel(model.id);
                            toast.success('Model deleted.');
                          } catch {
                            toast.error('Could not delete the model.');
                          }
                        });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
