-- Measures whether an index is worth adding, at a volume where the answer is
-- not obvious.
--
-- WHY THIS EXISTS: this deployment has ~180 messages. Postgres correctly
-- sequential-scans a table that fits in two pages, so EXPLAIN against real data
-- cannot distinguish a good index strategy from a bad one — every plan is
-- sub-millisecond either way. Claiming an index "improved" anything on that
-- evidence would be fabrication.
--
-- So: build a TEMP table of synthetic rows shaped like `messages`, measure the
-- dashboard's own count query with and without the candidate index, and return
-- both plans. Temp tables are per-session and vanish on disconnect, so this
-- touches no real data and leaves nothing behind.

create or replace function public.benchmark_message_index(row_count int default 200000)
returns table (stage text, plan text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  out_plan text;
begin
  -- Shaped like public.messages, populated with a plausible distribution:
  -- roughly half user rows, spread across 120 days.
  create temp table bench_messages on commit drop as
  select
    gen_random_uuid()                             as id,
    gen_random_uuid()                             as conversation_id,
    (case when i % 2 = 0 then 'user' else 'assistant' end) as role,
    'message body ' || i                          as content,
    now() - (random() * interval '120 days')      as created_at
  from generate_series(1, row_count) as i;

  analyze bench_messages;

  execute $q$
    explain (analyze, buffers, format text)
    select count(*) from bench_messages
     where role = 'user' and created_at >= now() - interval '1 day'
  $q$ into out_plan;

  stage := 'before: no index';
  plan := out_plan;
  return next;

  -- Partial on role='user': every caller filters on it, so indexing the
  -- assistant half would double the write cost for rows nothing queries.
  create index bench_idx on bench_messages (created_at) where role = 'user';
  analyze bench_messages;

  execute $q$
    explain (analyze, buffers, format text)
    select count(*) from bench_messages
     where role = 'user' and created_at >= now() - interval '1 day'
  $q$ into out_plan;

  stage := 'after: partial index on (created_at) where role = user';
  plan := out_plan;
  return next;
end;
$$;

revoke all on function public.benchmark_message_index(int) from public, anon, authenticated;
grant execute on function public.benchmark_message_index(int) to service_role;
