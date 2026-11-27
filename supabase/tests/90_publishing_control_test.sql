-- Publishing control (0016) and the built-in scheduler (0017).
\set ON_ERROR_STOP on

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

select pg_temp.check(not has_function_privilege('authenticated', 'public.verify_cron_secret(text)', 'execute'), 'signed-in users cannot test cron secrets');
select pg_temp.check(not has_function_privilege('anon', 'public.verify_cron_secret(text)', 'execute'), 'anonymous users cannot test cron secrets');
select pg_temp.check(not has_function_privilege('authenticated', 'public.setup_cron_jobs(text)', 'execute'), 'signed-in users cannot change the schedule');
select pg_temp.check(not has_function_privilege('authenticated', 'public.claim_token_refresh(uuid, interval)', 'execute'), 'signed-in users cannot take the token refresh lock');
select pg_temp.check(not has_table_privilege('authenticated', 'public.worker_runs', 'select') or not exists (select 1 from pg_policies where tablename = 'worker_runs'), 'worker heartbeats are not readable by browsers');
select pg_temp.check(public.verify_cron_secret('x') = false, 'short tokens are refused');
select pg_temp.check(public.verify_cron_secret(repeat('a', 64)) = false, 'no vault: every token is refused');

do $$
begin
  perform public.setup_cron_jobs('http://evil.example');
  raise exception 'FAILED: non-https address accepted';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok - only https app addresses are accepted';
end $$;

select 'PUBLISHING CONTROL TESTS PASSED';
