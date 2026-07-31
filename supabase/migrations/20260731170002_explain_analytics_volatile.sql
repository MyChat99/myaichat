-- Replaces 20260731170001: that version was declared STABLE, and Postgres
-- refuses EXPLAIN (ANALYZE) inside a non-volatile function because the
-- statement is genuinely executed. Same body, correct volatility.

create or replace function public.explain_analytics()
returns table (label text, plan text)
language plpgsql
-- VOLATILE, not STABLE. `EXPLAIN (ANALYZE)` actually runs the statement, so
-- Postgres refuses it inside a non-volatile function — "EXPLAIN is not allowed
-- in a non-volatile function". The first version of this migration said
-- `stable` and failed at call time rather than at apply time, which is why
-- this replacement exists rather than an edit: applied migrations are not
-- rewritten.
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
    ['dashboard: user messages 30 days (count)',
     'select count(*) from public.messages
       where role = ''user'' and created_at >= now() - interval ''30 days'''],
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
    execute 'explain (analyze, buffers, format text) ' || stmts[i][2]
      into out_plan;
    label := stmts[i][1];
    plan := out_plan;
    return next;
  end loop;
end;
$$;

revoke all on function public.explain_analytics() from public, anon, authenticated;
grant execute on function public.explain_analytics() to service_role;
