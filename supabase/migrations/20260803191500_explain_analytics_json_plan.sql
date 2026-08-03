-- Corrects 20260803190000, which left this function raising
-- `syntax error at or near "analyze"` on every call.
--
-- That migration tried to aggregate EXPLAIN's rows with
-- `select ... from (explain ...) as e(line)`. Postgres does not allow EXPLAIN
-- in a subquery, so the statement never parsed — and because the function body
-- is only parsed when it RUNS, `db push` reported success and the breakage
-- appeared at the first call. Recorded rather than quietly replaced: the same
-- trap as the STABLE/VOLATILE mistake that produced the _volatile migration.
--
-- `format json` avoids the problem outright. EXPLAIN in JSON returns a SINGLE
-- row containing the entire plan tree, so `execute ... into` — which takes the
-- first row and discards the rest — now captures everything instead of only the
-- top line.
--
-- Why the whole plan is needed: with `format text` and `into`, every plan this
-- function returned was one line, so the node underneath — the part naming the
-- index — never reached the caller. `verify:schema` could only assert on the
-- planner's COST, which scales with table size: the same query costed 6.89 on a
-- quiet database and 10.76 with test rows in flight, so a fixed threshold failed
-- for reasons unrelated to the index it was named after. The JSON tree carries
-- "Index Name", which is the thing actually worth asserting.
create or replace function public.explain_analytics()
returns table (label text, plan text)
language plpgsql
-- VOLATILE: EXPLAIN (ANALYZE) runs the statement, and Postgres refuses that
-- inside a non-volatile function.
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
    execute 'explain (analyze, buffers, format json) ' || stmts[i][2]
      into out_plan;
    label := stmts[i][1];
    plan := out_plan;
    return next;
  end loop;
end;
$$;

revoke all on function public.explain_analytics() from public, anon, authenticated;
grant execute on function public.explain_analytics() to service_role;
