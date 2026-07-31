-- A monotonic per-row sequence on messages, so "everything after this message"
-- is answerable exactly.
--
-- WHY (ISSUE-024): regenerate and edit-and-resubmit delete the pivot message
-- and everything after it. That was expressed as `created_at >= pivot`, and
-- `created_at` defaults to now(), which in Postgres is TRANSACTION time — every
-- row inserted by one statement shares an identical value. Two messages on the
-- same timestamp made the boundary ambiguous: regenerating from an assistant
-- reply could delete the user's question with it.
--
-- Additive. No existing column changes type or meaning, and `created_at`
-- remains the display timestamp.

-- 1. Nullable first, so the table is never rewritten with a volatile default.
alter table public.messages add column if not exists seq bigint;

-- 2. Backfill in reading order. Deliberately NOT physical order: a bigserial
--    added directly numbers rows however they happen to sit on disk, which for
--    an updated table is not insertion order. Ordering by (created_at, id)
--    keeps every existing thread reading exactly as it does today, and the id
--    tiebreak makes the result deterministic where timestamps already collide.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.messages
)
update public.messages m
   set seq = o.rn
  from ordered o
 where m.id = o.id
   and m.seq is null;

-- 3. Attach a sequence for new rows, starting past everything backfilled.
create sequence if not exists public.messages_seq_seq owned by public.messages.seq;

select setval(
  'public.messages_seq_seq',
  coalesce((select max(seq) from public.messages), 0) + 1,
  false
);

alter table public.messages alter column seq set default nextval('public.messages_seq_seq');
alter table public.messages alter column seq set not null;

-- 4. The index the truncation and history-window queries actually use.
create index if not exists messages_conversation_seq_idx
  on public.messages (conversation_id, seq);
