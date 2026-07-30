# Phase 3 — Provider Abstraction Layer + Second Provider + Model Selector

## Goal

LLM access goes through a clean abstraction; OpenAI added as a second provider; users choose the model per conversation.

## Tasks

1. Define a `ChatProvider` interface in /lib/providers: `streamChat()`, `listModels()`, `validateKey()`, with shared types for messages, usage, and stream events.
2. Implement `AnthropicProvider` and `OpenAIProvider` adapters using the official SDKs. Refactor Phase 2's route to use the abstraction — no provider-specific code outside /lib/providers.
3. Provider registry that maps DB `providers`/`models` rows to adapter instances. Where a provider offers a models-list endpoint, support dynamic fetching via `listModels()`.
4. Model selector in the chat header showing enabled models grouped by provider (with provider logos). Selection stored on the conversation; switching models mid-conversation starts using the new model for subsequent messages.
5. Record per-message model, token usage, and estimated cost into `usage_logs` using per-model cost fields.
6. Normalize provider errors into typed errors the UI can display consistently.

## Acceptance criteria

- Same conversation UX works against both providers; switching models works
- Adding a hypothetical third provider requires ONLY a new adapter file + DB rows (document this in a short /lib/providers/README.md)
- usage_logs rows created with correct token counts
- lint + type-check + build pass
