-- Link a usage row to the message it paid for.
--
-- `usage_logs` records what every generation cost, and `messages` records what
-- was said, but nothing joined them — so the app could tell you what you spent
-- today and never what a particular answer cost. That is the one number a
-- multi-provider chat app is uniquely able to show, and it was one column away.
--
-- Nullable on purpose, and NOT backfilled:
--
--   · rows written before this migration genuinely do not know their message,
--     and inventing a correlation from timestamps would be a guess presented as
--     a fact;
--   · a comparison run (/api/compare) has no message at all — it is one turn,
--     several answers, none of them stored.
--
-- `on delete set null` rather than cascade: deleting a conversation must not
-- erase what it cost. Spend that disappears when a user tidies up is a billing
-- record that cannot be trusted.

alter table public.usage_logs
  add column if not exists message_id uuid references public.messages (id) on delete set null;

comment on column public.usage_logs.message_id is
  'The assistant message this generation produced. NULL for pre-migration rows and for comparison runs, which store no message.';

-- Partial: the only query is "the cost of these messages", which never asks
-- about the NULLs.
create index if not exists usage_logs_message_id_idx
  on public.usage_logs (message_id)
  where message_id is not null;
