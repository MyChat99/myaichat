'use client';

import { Check, Loader2, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveAppearance } from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AA_NORMAL,
  contrastRatioHex,
  parseHex,
  readableForeground,
  toHex,
} from '@/lib/theme/contrast';
import { themeCss } from '@/lib/theme/css';
import {
  ACCENT_PRESETS,
  BUBBLE_STYLES,
  DEFAULT_APPEARANCE,
  FONT_SIZES,
  getTheme,
  THEME_ACCENT,
  THEMES,
} from '@/lib/theme/presets';
import type { Appearance } from '@/lib/theme/preferences';

/**
 * Appearance panel with live preview.
 *
 * Preview works by writing the same generated CSS the server emits into the
 * live `#theme-tokens` block, so what you see while choosing is exactly what
 * the server will render on the next load — rather than an approximation that
 * can drift from it.
 */

const MODES = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

/**
 * Mirrors `accentToHex` on the server, including its `null`.
 *
 * It has to: the preview writes into the same `#theme-tokens` block the server
 * renders, so any disagreement here shows up as the panel previewing one colour
 * and the next page load showing another. This previously fell back to
 * ACCENT_PRESETS[1] (blue) for an unrecognised name, which is exactly the case
 * THEME_ACCENT is.
 */
function resolveAccentHex(accent: string): string | null {
  if (accent === THEME_ACCENT) return null;
  if (accent.startsWith('#')) return accent;
  return ACCENT_PRESETS.find((a) => a.name === accent)?.hex ?? null;
}

export function AppearancePanel({ initial }: { initial: Appearance }) {
  const [draft, setDraft] = useState<Appearance>(initial);
  const [customHex, setCustomHex] = useState(
    initial.accentColor.startsWith('#') ? initial.accentColor : '',
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /**
   * What the server last rendered with.
   *
   * The preview writes straight to the document, so leaving this page with an
   * unsaved draft would otherwise carry a theme the server knows nothing about
   * into every subsequent page — `data-theme` says one thing, the markup was
   * built for another. That mismatch is what removed the navigation bar once.
   */
  const savedRef = useRef<Appearance>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  /**
   * Whether the OS is asking for dark, tracked in state rather than read
   * during render.
   *
   * Reading `window.matchMedia` inline is a server/client branch: the server
   * has no window and renders the light ink, the client has one and renders
   * the dark ink, and React throws a hydration mismatch for the difference.
   * That is exactly the first bullet in its own error message, and it was a
   * real error in the dev overlay on this page.
   *
   * Starting at `false` matches what the server rendered, so hydration agrees;
   * the effect then corrects it on the first commit. The listener keeps it
   * honest if the OS setting changes while the panel is open.
   */
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setSystemDark(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  // Which mode the preview is currently showing, so a theme-following accent
  // can be reported honestly — it is two different colours, and which one you
  // get depends on this.
  const previewingDark = draft.theme === 'dark' || (draft.theme === 'system' && systemDark);

  const draftTheme = getTheme(draft.presetTheme);
  const accentHex =
    resolveAccentHex(draft.accentColor) ?? draftTheme[previewingDark ? 'dark' : 'light'].accent;

  /** Applies the draft to the live document — same code path as the server. */
  const preview = useCallback((next: Appearance) => {
    const el = document.getElementById('theme-tokens');
    if (el) el.textContent = themeCss(next.presetTheme, resolveAccentHex(next.accentColor));

    const root = document.documentElement;
    root.dataset.theme = next.presetTheme;
    root.dataset.bubble = next.bubbleStyle;
    root.dataset.fontSize = next.fontSize;
    root.dataset.themeMode = next.theme;
    root.style.fontSize = `${FONT_SIZES.find((f) => f.id === next.fontSize)?.rootPx ?? 16}px`;

    const dark =
      next.theme === 'dark' ||
      (next.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
  }, []);

  useEffect(() => {
    preview(draft);
  }, [draft, preview]);

  // Unsaved previews do not leave this page.
  useEffect(() => {
    return () => preview(savedRef.current);
  }, [preview]);

  /**
   * Applies a change AND commits it. There is no draft to lose.
   *
   * This panel used to preview on click and write only on a separate "Save
   * appearance" press. Because the preview repaints the whole page, choosing a
   * theme looked exactly like setting it — so navigating away silently
   * discarded a choice the user had every reason to believe was made, and the
   * theme appeared not to persist. That was the reported bug, and no amount of
   * correctness in the storage layer would have fixed it.
   *
   * A theme is a preference, not a form submission: nothing here is destructive
   * and nothing needs confirming, so selecting it IS choosing it.
   */
  function update(patch: Partial<Appearance>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    commit(next);
  }

  function commit(next: Appearance) {
    setStatus('saving');
    startTransition(async () => {
      const result = await saveAppearance(next);
      if (result.ok) {
        savedRef.current = next;
        setStatus('saved');
        // The theme decides server-rendered STRUCTURE here, not only colour, so
        // the document must be rebuilt rather than recoloured.
        router.refresh();
      } else {
        setStatus('error');
        toast.error(result.error);
      }
    });
  }

  // Live legibility readout for a custom accent. A mid-tone colour can fail AA
  // against both black and white, and the honest thing is to say so rather
  // than silently ship unreadable buttons.
  const accentContrast = useMemo(() => {
    const rgb = parseHex(accentHex);
    if (!rgb) return null;
    const fg = toHex(readableForeground(rgb));
    const ratio = contrastRatioHex(fg, accentHex);
    return ratio === null ? null : { ratio, fg, passes: ratio >= AA_NORMAL };
  }, [accentHex]);

  /**
   * Back to what a new account gets.
   *
   * Distinct from "Discard changes", which returns to what is *saved*. Without
   * this there is no route back to the default once it has been changed and
   * saved — the mode, size and style defaults are all reachable by clicking the
   * right button, but the default accent is THEME_ACCENT, and reconstructing
   * "no accent override" from a row of coloured circles is not something anyone
   * should have to work out. It stages the change rather than saving it, so the
   * preview shows the default before it is committed.
   */
  function restoreDefaults() {
    setDraft(DEFAULT_APPEARANCE);
    setCustomHex('');
    commit(DEFAULT_APPEARANCE);
  }

  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_APPEARANCE);

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------- mode */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Mode</h2>
          <p className="text-muted-foreground text-xs">
            System follows your operating system and updates when it changes.
          </p>
        </div>
        <div className="flex gap-2">
          {MODES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant={draft.theme === id ? 'default' : 'outline'}
              size="sm"
              onClick={() => update({ theme: id })}
            >
              <Icon className="mr-1.5 size-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- theme */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Theme</h2>
          <p className="text-muted-foreground text-xs">
            Every theme meets WCAG AA contrast in both light and dark.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEMES.map((theme) => {
            const swatch = draft.theme === 'dark' ? theme.dark : theme.light;
            const selected = draft.presetTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => update({ presetTheme: theme.id })}
                aria-pressed={selected}
                className={`hover:border-foreground/40 flex flex-col gap-2 rounded-lg border p-2 text-left transition ${
                  selected ? 'ring-ring border-transparent ring-2' : ''
                }`}
              >
                <span className="flex gap-1" aria-hidden>
                  {[swatch.background, swatch.surfaceHover, swatch.accent].map((c, i) => (
                    <span
                      key={i}
                      className="border-border size-5 rounded border"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="flex items-center justify-between text-xs">
                  {theme.label}
                  {selected ? <Check className="size-3" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------- accent */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Accent colour</h2>
          <p className="text-muted-foreground text-xs">
            Used for buttons, your messages and focus rings. The first swatch follows the theme —
            each theme brings its own accent for light and dark.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Two-tone, because a theme-following accent genuinely is two
              colours — light-mode ink on the left, dark-mode on the right. */}
          <button
            type="button"
            aria-label="Match theme"
            title="Match theme"
            aria-pressed={draft.accentColor === THEME_ACCENT}
            onClick={() => {
              setCustomHex('');
              update({ accentColor: THEME_ACCENT });
            }}
            className={`size-8 overflow-hidden rounded-full border transition ${
              draft.accentColor === THEME_ACCENT ? 'ring-ring ring-2 ring-offset-2' : ''
            }`}
          >
            <span className="flex size-full" aria-hidden>
              <span className="h-full w-1/2" style={{ backgroundColor: draftTheme.light.accent }} />
              <span className="h-full w-1/2" style={{ backgroundColor: draftTheme.dark.accent }} />
            </span>
          </button>

          {ACCENT_PRESETS.map((accent) => (
            <button
              key={accent.name}
              type="button"
              aria-label={accent.name}
              aria-pressed={draft.accentColor === accent.name}
              onClick={() => {
                setCustomHex('');
                update({ accentColor: accent.name });
              }}
              className={`size-8 rounded-full border transition ${
                draft.accentColor === accent.name ? 'ring-ring ring-2 ring-offset-2' : ''
              }`}
              style={{ backgroundColor: accent.hex }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="customAccent" className="text-xs">
              Custom
            </Label>
            <Input
              id="customAccent"
              value={customHex}
              placeholder="#7c3aed"
              onChange={(e) => {
                const value = e.target.value;
                setCustomHex(value);
                if (parseHex(value)) update({ accentColor: value.toLowerCase() });
              }}
              className="h-8 w-28 font-mono text-xs"
            />
          </div>

          {accentContrast ? (
            <span
              className={`text-xs ${accentContrast.passes ? 'text-muted-foreground' : 'text-destructive'}`}
            >
              {accentContrast.ratio.toFixed(1)}:1 —{' '}
              {accentContrast.passes
                ? 'meets AA'
                : `below AA (${AA_NORMAL}:1); text on this colour will be hard to read`}
            </span>
          ) : null}
        </div>
      </section>

      {/* ----------------------------------------------------- font size */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Text size</h2>
        <div className="flex gap-2">
          {FONT_SIZES.map((size) => (
            <Button
              key={size.id}
              type="button"
              variant={draft.fontSize === size.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => update({ fontSize: size.id })}
            >
              {size.label}
            </Button>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- bubble style */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Message style</h2>
          <p className="text-muted-foreground text-xs">
            Bubbles keeps chat framing; Document reads like a written page.
          </p>
        </div>
        <div className="flex gap-2">
          {BUBBLE_STYLES.map((style) => (
            <Button
              key={style.id}
              type="button"
              variant={draft.bubbleStyle === style.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => update({ bubbleStyle: style.id })}
            >
              {style.label}
            </Button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- preview */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Preview</h2>
        <div className="border-border bg-background space-y-3 rounded-lg border p-4">
          <div className="flex justify-end">
            <div
              className={
                draft.bubbleStyle === 'bubbles'
                  ? 'bg-primary text-primary-foreground max-w-[80%] rounded-2xl px-4 py-2.5 text-sm'
                  : 'text-foreground max-w-[80%] text-sm font-medium'
              }
            >
              How do I reverse a string in Python?
            </div>
          </div>
          <div className="text-foreground space-y-2 text-sm">
            <p>You can slice it with a negative step:</p>
            <pre className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-xs">
              <code>{'text = "hello"\nreversed_text = text[::-1]'}</code>
            </pre>
            <p className="text-muted-foreground text-xs">
              Muted text looks like this — held to the same contrast bar.
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-2">
        {/* No "Save" button: every control above commits as you use it. What is
            left is the one action that is not itself a choice. */}
        <span aria-live="polite" className="text-muted-foreground text-xs">
          {status === 'saving' ? (
            <>
              <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
              Saving…
            </>
          ) : status === 'saved' ? (
            'Saved. Applies on every device.'
          ) : status === 'error' ? (
            'Not saved — see the message above.'
          ) : (
            'Changes save as you make them.'
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={restoreDefaults}
          disabled={pending || isDefault}
          className="ml-auto"
        >
          <RotateCcw className="mr-1.5 size-3.5" />
          Reset to default
        </Button>
      </div>
    </div>
  );
}
