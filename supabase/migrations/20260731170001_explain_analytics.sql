-- Query plans for the aggregations the admin pages actually run.
--
-- Deliberately takes NO parameters and EXPLAINs a FIXED set of statements.
--
-- The flexible version — `explain(sql text)` — would be far more convenient and
-- is a general-purpose SQL executor wearing a hat. PostgREST otherwise exposes
-- only CRUD on tables, so such a function would ADD capability that does not
-- currently exist, for the benefit of a profiling task. A fixed list gives the
-- same answer with no new attack surface.
--
-- Same shape as `rls_status()`: SECURITY DEFINER, revoked from everyone,
-- granted to service_role only.

create or replace function public.explain_analytics()
returns table (label text, plan text)
language plpgsql
stable
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
