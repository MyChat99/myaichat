# Phase 2 — Chat Interface with Streaming (Single Provider)

## Goal
A user can hold a real streamed conversation with one AI provider (Anthropic), with history persisted.

## Prerequisites
Phase 1 complete. An Anthropic API key available (put in env var for now; encrypted admin storage comes in Phase 4).

## Tasks
1. Build the chat UI: sidebar (conversation list: create, rename, delete, pin, search), main thread view, composer with auto-growing textarea, Enter-to-send / Shift+Enter newline.
2. Server route handler `/api/chat`: authenticates the user, validates input with Zod, calls Anthropic SDK with streaming, relays tokens to the client via SSE/streaming response. API key read server-side only.
3. Render assistant messages as sanitized Markdown with syntax-highlighted code blocks + copy button.
4. Persist conversations and messages (with input/output token counts) to Supabase. Auto-generate a conversation title from the first exchange.
5. Message actions: copy, regenerate last response, edit-and-resubmit a user message.
6. Stop-generation button that aborts the stream server-side.
7. Streaming UX: typing indicator, smooth auto-scroll, "scroll to bottom" pill when user scrolls up.
8. Error states with retry: provider error, rate limit, network failure.
9. Basic per-user rate limit on /api/chat.
10. Empty state with 4 suggested starter prompts.
11. Responsive: collapsible sidebar on mobile.

## Acceptance criteria
- Full streamed conversation works; refresh restores history from DB
- Code blocks highlight and copy correctly; XSS attempt in a message renders inert
- Stop button halts generation immediately; regenerate/edit-resubmit work
- lint + type-check + build pass

## Out of scope
Only one provider. No model selector UI, no attachments, no theming.
