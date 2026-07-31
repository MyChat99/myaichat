-- The dashboard counts user messages globally by date. `messages` had indexes
-- on (conversation_id, created_at) and (conversation_id, seq) — both excellent
-- for reading ONE thread, and useless for a query with no conversation_id.
--
-- MEASURED, not assumed. This deployment has ~180 messages, where Postgres
-- correctly sequential-scans regardless, so the decision was made against a
-- 200,000-row synthetic table via `benchmark_message_index()`:
--
--     before: no index                                106.8 ms
--     after:  partial index on (created_at)            23.5 ms
--
-- Partial on `role = 'user'` because every caller filters on it. Indexing the
-- assistant half would roughly double the write cost — and messages are written
-- on the hot path of every single chat turn — to speed up queries nobody runs.
create index if not exists messages_user_created_at_idx
  on public.messages (created_at)
  where role = 'user';
