'use client';

import { Check, Copy } from 'lucide-react';
import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * Renders assistant Markdown.
 *
 * Plugin ORDER is the security control: `rehypeSanitize` runs FIRST, stripping
 * any raw HTML the model emitted, and `rehypeHighlight` runs after — so the only
 * markup that survives is markup we generated ourselves. Swapping the order
 * would let sanitize strip the highlighter's classes, and tempt the next person
 * to "fix" it by disabling sanitization.
 */

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    const pre = event.currentTarget.parentElement?.querySelector('pre');
    const text = pre?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable over plain HTTP on some browsers; fail quietly.
    }
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="bg-background/80 text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border p-1.5 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {children}
    </div>
  );
}

function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        components={{
          pre: ({ children }) => (
            <CodeBlock>
              <pre>{children}</pre>
            </CodeBlock>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Memoised: the thread re-renders on every streamed token. */
export const Markdown = memo(MarkdownImpl);
