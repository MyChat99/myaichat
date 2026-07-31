'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  deleteProviderKey,
  setProviderKey,
  testProviderConnection,
  type ConnectionTest,
} from '@/app/(app)/admin/actions';
import { ProviderLogo } from '@/components/chat/provider-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

import { toggleProvider } from '@/app/(app)/admin/actions';

export type ProviderCard = {
  name: string;
  last4: string | null;
  enabled: boolean;
  hasKey: boolean;
  hasAdapter: boolean;
};

function ProviderRow({ provider }: { provider: ProviderCard }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const key = draft.trim();
    if (!key) return;

    startTransition(async () => {
      try {
        await setProviderKey(provider.name, key);
        // Clear the draft immediately — a provider key should not sit in
        // component state (or a React DevTools tree) any longer than needed.
        setDraft('');
        setEditing(false);
        setTest(null);
        toast.success('Key saved and encrypted.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the key.');
      }
    });
  }

  function runTest() {
    setTest(null);
    startTransition(async () => {
      const result = await testProviderConnection(provider.name);
      setTest(result);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ProviderLogo provider={provider.name} />
          {provider.name}
          {!provider.hasAdapter ? (
            <Badge variant="secondary" className="text-[10px]">
              no adapter
            </Badge>
          ) : null}
        </CardTitle>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {provider.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <Switch
            checked={provider.enabled}
            disabled={pending || !provider.hasKey}
            aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.name}`}
            onCheckedChange={(next) => {
              startTransition(async () => {
                try {
                  await toggleProvider(provider.name, next);
                } catch {
                  toast.error('Could not update the provider.');
                }
              });
            }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">API key</p>
            <p className="font-mono text-sm">
              {provider.last4 ? `••••••••${provider.last4}` : 'Not set'}
            </p>
          </div>

          {!editing ? (
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                {provider.hasKey ? 'Rotate' : 'Set key'}
              </Button>
              {provider.hasKey ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!confirm(`Delete the ${provider.name} key? This also disables it.`)) return;
                    startTransition(async () => {
                      try {
                        await deleteProviderKey(provider.name);
                        setTest(null);
                        toast.success('Key deleted.');
                      } catch {
                        toast.error('Could not delete the key.');
                      }
                    });
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Paste the ${provider.name} API key`}
              aria-label={`${provider.name} API key`}
              className="font-mono text-sm"
            />
            <Button type="button" size="sm" disabled={pending || !draft.trim()} onClick={save}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft('');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !provider.hasKey}
            onClick={runTest}
          >
            {pending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            Test connection
          </Button>

          {test ? (
            <span
              role="status"
              className={`flex items-center gap-1.5 text-xs ${test.ok ? 'text-success' : 'text-destructive'}`}
            >
              {test.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {test.message}
              {test.latencyMs !== null ? ` (${test.latencyMs}ms)` : ''}
            </span>
          ) : null}
        </div>

        <p className="text-muted-foreground text-xs">
          Test connection performs a real one-token generation. A key with no credit authenticates
          and lists models perfectly well — only generating proves it works.
        </p>
      </CardContent>
    </Card>
  );
}

export function ProviderCards({ providers }: { providers: ProviderCard[] }) {
  if (providers.length === 0) {
    return <p className="text-muted-foreground text-sm">No providers yet. Run `npm run seed`.</p>;
  }

  return (
    <div className="space-y-4">
      {providers.map((provider) => (
        <ProviderRow key={provider.name} provider={provider} />
      ))}
    </div>
  );
}
