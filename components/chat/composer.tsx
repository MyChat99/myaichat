'use client';

import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
};

const MAX_HEIGHT_PX = 200;

export function Composer({ value, onChange, onSubmit, onStop, streaming, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: reset to auto first so the box can shrink when text is deleted.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Ignore IME composition so
    // committing a candidate doesn't fire the message.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!streaming && value.trim()) onSubmit();
    }
  }

  return (
    <div className="border-border bg-background border-t p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message…"
          aria-label="Message"
          className="border-input bg-background focus-visible:ring-ring max-h-[200px] flex-1 resize-none rounded-lg border px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        />

        {streaming ? (
          <Button
            type="button"
            onClick={onStop}
            variant="outline"
            size="icon"
            aria-label="Stop generating"
          >
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onSubmit}
            disabled={disabled || !value.trim()}
            size="icon"
            aria-label="Send message"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>

      <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
