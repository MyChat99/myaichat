'use client';

import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Markdown } from '@/components/chat/markdown';
import { ProviderLogo } from '@/components/chat/provider-logo';
import { Button } from '@/components/ui/button';

export type ComparableModel = {
  id: string;
  displayName: string;
  providerName: string;
};

/** One column's state. */
type Column = {
  modelId: string;
  displayName: string;
  providerName: string;
  text: string;
  status: 'waiting' | 'streaming' | 'done' | 'error';
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  totalMs?: number;
  firstTokenMs?: number;
};

const MIN_MODELS = 2;
const MAX_MODELS = 4;

function money(usd: number): string {
  if (usd === 0) return '$0.0000';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

export function CompareClient({ models }: { models: ComparableModel[] }) {
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string[]>(() => models.slice(0, 2).map((m) => m.id));
  const [columns, setColumns] = useState<Column[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const enoughModels = selected.length >= MIN_MODELS;
  const canRun = enoughModels && prompt.trim().length > 0 && !running;

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_MODELS) return prev;
      return [...prev, id];
    });
  }

  async function run() {
    if (!canRun) return;
    setError(null);
    setRunning(true);

    // Columns are created up front and in the order chosen, so the layout does
    // not reflow as answers arrive — the slowest model's column is already
    // there, empty, rather than appearing late and shifting the others.
    const ordered = selected
      .map((id) => models.find((m) => m.id === id))
      .filter((m): m is ComparableModel => Boolean(m));

    setColumns(
      ordered.map((m) => ({
        modelId: m.id,
        displayName: m.displayName,
        providerName: m.providerName,
        text: '',
        status: 'waiting' as const,
      })),
    );

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), modelIds: selected }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? 'The comparison could not be started.');
        setColumns([]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // A chunk boundary lands mid-line often enough that ignoring it works
        // in development and fails in production. Keep the remainder.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }

          setColumns((prev) =>
            prev.map((c) => {
              if (c.modelId !== event.modelId) return c;
              switch (event.type) {
                case 'text':
                  return { ...c, status: 'streaming', text: c.text + String(event.text) };
                case 'model_done':
                  return {
                    ...c,
                    status: 'done',
                    inputTokens: Number(event.inputTokens),
                    outputTokens: Number(event.outputTokens),
                    costUsd: Number(event.costUsd),
                    totalMs: Number(event.totalMs),
                    firstTokenMs:
                      event.firstTokenMs === null ? undefined : Number(event.firstTokenMs),
                  };
                case 'model_error':
                  return { ...c, status: 'error', error: String(event.message) };
                default:
                  return c;
              }
            }),
          );
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError('The comparison was interrupted.');
      }
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  function stop() {
    abort.current?.abort();
    setRunning(false);
  }

  const finished = columns.filter((c) => c.status === 'done');
  const totalCost = finished.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
  const fastest =
    finished.length > 1
      ? finished.reduce((best, c) =>
          (c.firstTokenMs ?? Infinity) < (best.firstTokenMs ?? Infinity) ? c : best,
        )
      : null;
  const cheapest =
    finished.length > 1
      ? finished.reduce((best, c) => ((c.costUsd ?? 0) < (best.costUsd ?? 0) ? c : best))
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-press="compare-setup">
        <div data-press="coupon-l">
          <span>Ask the presses</span>
          <span>
            {selected.length} of {MAX_MODELS} selected
          </span>
        </div>

        <fieldset data-press="press-picker">
          <legend className="sr-only">Models to compare</legend>
          {models.map((m) => {
            const on = selected.includes(m.id);
            const full = !on && selected.length >= MAX_MODELS;
            return (
              <button
                key={m.id}
                type="button"
                role="switch"
                aria-checked={on}
                disabled={full || running}
                onClick={() => toggle(m.id)}
                data-press="press-chip"
                data-on={on ? 'true' : 'false'}
              >
                <ProviderLogo provider={m.providerName} />
                {m.displayName}
              </button>
            );
          })}
        </fieldset>

        <div data-press="compare-field">
          <label htmlFor="compare-prompt" className="sr-only">
            One prompt, sent to every selected model
          </label>
          <textarea
            id="compare-prompt"
            value={prompt}
            disabled={running}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void run();
              }
            }}
            rows={2}
            placeholder="Ask every press the same thing…"
            className="max-h-[160px] w-full resize-none text-sm focus-visible:outline-none disabled:opacity-50"
          />
        </div>

        <div data-press="coupon-b">
          <span data-press="rail-left">
            {!enoughModels ? (
              <span data-press="compare-hint">Pick at least {MIN_MODELS} presses</span>
            ) : (
              <span data-press="compare-hint">
                {selected.length} presses · one prompt · billed {selected.length}×
              </span>
            )}
          </span>

          {running ? (
            <Button type="button" size="sm" onClick={stop} data-press="quill">
              <span data-press="quill-label">Stop</span>
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={run} disabled={!canRun} data-press="quill">
              <span data-press="quill-label">Set it ⏎</span>
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" data-press="compare-error">
          {error}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {columns.length === 0 ? (
          <div data-press="compare-empty">
            <p data-press="lede-num">Two presses, one question</p>
            <h2 data-press="headline">
              Set the same question
              <br />
              to <mark>every press</mark>.
            </h2>
            <p data-press="standfirst">
              The same prompt goes to each model at once. You get every answer side by side, with
              what each one cost, how many tokens it used, and how long it took to say its first
              word.
            </p>
          </div>
        ) : (
          <>
            <div data-press="compare-grid" data-count={columns.length}>
              {columns.map((c) => (
                <section key={c.modelId} data-press="compare-column" data-status={c.status}>
                  <header data-press="compare-head">
                    <span data-press="compare-model">
                      <ProviderLogo provider={c.providerName} />
                      {c.displayName}
                    </span>
                    {c.status === 'done' ? (
                      <span data-press="compare-metric">{money(c.costUsd ?? 0)}</span>
                    ) : c.status === 'error' ? (
                      <span data-press="compare-metric">failed</span>
                    ) : (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    )}
                  </header>

                  <div data-press="compare-body">
                    {c.status === 'error' ? (
                      <p role="alert" data-press="compare-failed">
                        {c.error}
                      </p>
                    ) : c.text ? (
                      <Markdown content={c.text} />
                    ) : (
                      <p data-press="compare-waiting">Setting type…</p>
                    )}
                  </div>

                  {c.status === 'done' ? (
                    <footer data-press="compare-foot">
                      <span>{c.inputTokens ?? 0} in</span>
                      <span>{c.outputTokens ?? 0} out</span>
                      {c.firstTokenMs !== undefined ? <span>{c.firstTokenMs}ms first</span> : null}
                      <span>{((c.totalMs ?? 0) / 1000).toFixed(1)}s total</span>
                    </footer>
                  ) : null}
                </section>
              ))}
            </div>

            {finished.length > 1 ? (
              <div data-press="colophon" data-compare-summary>
                <div data-press="col-c">
                  <div data-press="col-l">This run cost</div>
                  <div data-press="col-v">{money(totalCost)}</div>
                </div>
                <div data-press="col-c">
                  <div data-press="col-l">First to answer</div>
                  <div data-press="col-v">{fastest?.displayName ?? '—'}</div>
                </div>
                <div data-press="col-c">
                  <div data-press="col-l">Cheapest</div>
                  <div data-press="col-v">{cheapest?.displayName ?? '—'}</div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
