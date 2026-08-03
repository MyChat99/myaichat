-- explain_analytics(): return the WHOLE plan, not just its first line.
--
-- `execute ... into out_plan` takes the FIRST ROW of EXPLAIN's output and
-- discards the rest, so every plan this function returned was a single line:
--
--   Aggregate  (cost=6.88..6.89 rows=1 width=8) (actual time=0.039..0.039 ...)
--
-- The node underneath — the part that says whether an index was used — never
-- reached the caller. `verify:schema` could therefore only assert on the
-- planner's COST estimate, which scales with table size: the same query costed
-- 6.89 on a quiet database and 10.76 while test rows were in flight, so an
-- absolute threshold turned into a failure that had nothing to do with the
-- index it was named after.
--
-- Aggregating the rows keeps the return type `text` and keeps the existing
-- assertions working (the first line is unchanged, so `startsWith('Limit')` and
-- the `cost=` regex still match) while making `Index Scan using ...` visible,
-- which is what the check actually wanted to know.
--
-- A replacement migration rather than an edit: applied migrations are not
-- rewritten. Same reason the _volatile migration exists.
create or replace function public.explain_analytics()
returns table (label text, plan text)
language plpgsql
-- VOLATILE for the same reason as before: EXPLAIN (ANALYZE) runs the statement,
-- and Postgres refuses that inside a non-volatile function.
volatile
security definer
set search_path = ''
as $$
declare
  stmts text[][] := array[
    ['analytics: usage over 30 days',
     'select created_at, user_id, model_id, input_tokens, output_tokens, estimated_cost
        from public.usage_logs
       where created_at >= now() - interval ''30 days''
       order by created_at asc limit 50000'],
    ['dashboard: usage today',
     'select user_id, input_tokens, output_tokens, estimated_cost
        from public.usage_logs
       where created_at >= date_trunc(''day'', now())'],
    ['dashboard: user messages today (count)',
     'select count(*) from public.messages
       where role = ''user'' and created_at >= date_trunc(''day'', now())'],
    ['drill-in: one user''s usage',
     'select model_id, input_tokens, output_tokens, estimated_cost, created_at
        from public.usage_logs
       where user_id = ''00000000-0000-4000-8000-000000000000''
         and created_at >= now() - interval ''30 days''
       order by created_at desc limit 50000'],
    ['audit export: 90 days',
     'select created_at, actor_id, action, target_type, target_id, ip, metadata
        from public.audit_logs
       where created_at >= now() - interval ''90 days''
       order by created_at desc limit 10000'],
    ['rate limit: a user''s messages this hour',
     'select count(*) from public.messages
       where role = ''user'' and created_at >= now() - interval ''1 hour''']
  ];
  i int;
  out_plan text;
begin
  for i in 1 .. array_length(stmts, 1) loop
    -- Every row of the EXPLAIN output, newline-joined, in plan order.
    execute 'select string_agg(line, E''\n'' order by n)
               from (select row_number() over () as n, line
                       from (' || 'explain (analyze, buffers, format text) '
                                || stmts[i][2] || ') as e(line)) as numbered'
      into out_plan;
    label := stmts[i][1];
    plan := out_plan;
    return next;
  end loop;
end;
$$;

revoke all on function public.explain_analytics() from public, anon, authenticated;
grant execute on function public.explain_analytics() to service_role;
