-- Spec 13: stale publish job recovery.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end $$;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;
create or replace function pg_temp.fails(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;

select pg_temp.as_admin();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'j@test');
create temp table j_ws as select id from workspaces where owner_id = '00000000-0000-0000-0000-0000000000f1' and kind = 'fashion';
insert into pin_drafts (id, workspace_id, batch_id, idea, title, source, status, scheduled_for) values
  ('00000000-0000-0000-0000-00000000d001', (select id from j_ws), gen_random_uuid(), 'a', 'A', 'manual', 'scheduled', now()),
  ('00000000-0000-0000-0000-00000000d002', (select id from j_ws), gen_random_uuid(), 'b', 'B', 'manual', 'scheduled', now()),
  ('00000000-0000-0000-0000-00000000d003', (select id from j_ws), gen_random_uuid(), 'c', 'C', 'manual', 'scheduled', now());
insert into publish_jobs (workspace_id, draft_id, board_id, run_at, status, attempts, claimed_at) values
  ((select id from j_ws), '00000000-0000-0000-0000-00000000d001', 'b', now(), 'running', 1, now() - interval '30 minutes'),
  ((select id from j_ws), '00000000-0000-0000-0000-00000000d002', 'b', now(), 'running', 3, now() - interval '30 minutes'),
  ((select id from j_ws), '00000000-0000-0000-0000-00000000d003', 'b', now(), 'running', 1, now() - interval '1 minute');
select pg_temp.check((select requeued = 1 and failed = 1 from recover_stale_publish_jobs()), 'recovers one stale job and fails one out of attempts');
select pg_temp.check((select status = 'queued' and uncertain from publish_jobs where draft_id = '00000000-0000-0000-0000-00000000d001'), 'stale job is re-queued as uncertain (checks Pinterest first)');
select pg_temp.check((select status = 'failed' from publish_jobs where draft_id = '00000000-0000-0000-0000-00000000d002'), 'job without attempts left fails for good');
select pg_temp.check((select status = 'approved' from pin_drafts where id = '00000000-0000-0000-0000-00000000d002'), 'its pin goes back to Approved');
select pg_temp.check((select status = 'running' from publish_jobs where draft_id = '00000000-0000-0000-0000-00000000d003'), 'a job that is still working is left alone');
select pg_temp.check((select count(*) = 1 from claim_publish_job((select id from publish_jobs where draft_id = '00000000-0000-0000-0000-00000000d001'))), 'the re-queued job can be claimed again');
select pg_temp.check((select claimed_at > now() - interval '1 minute' from publish_jobs where draft_id = '00000000-0000-0000-0000-00000000d001'), 'claiming records the claim time');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select pg_temp.check(pg_temp.fails($$select * from recover_stale_publish_jobs()$$), 'users cannot run job recovery');
select pg_temp.check(pg_temp.fails($$select * from claim_publish_job(gen_random_uuid())$$), 'users cannot claim jobs');

reset role;
\echo JOB RECOVERY TESTS PASSED
