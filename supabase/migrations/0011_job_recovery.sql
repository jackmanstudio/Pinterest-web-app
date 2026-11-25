-- Spec 13: publish jobs survive a crashed or timed-out worker.
-- A job left in 'running' (the function died mid-publish) is put back in the
-- queue as "uncertain", so the runner first checks Pinterest for the pin and
-- never posts it twice. Jobs out of attempts fail for good (the dead-letter
-- state, shown to the user) and their pin goes back to Approved.

alter table public.publish_jobs add column if not exists claimed_at timestamptz;

create or replace function public.claim_publish_job(p_job uuid) returns setof public.publish_jobs
language sql security definer set search_path = public as $$
  update public.publish_jobs
     set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()), claimed_at = now()
   where id = p_job and status = 'queued' and run_at <= now() and attempts < max_attempts
  returning *;
$$;
revoke all on function public.claim_publish_job from public, anon, authenticated;
grant execute on function public.claim_publish_job to service_role;

create or replace function public.recover_stale_publish_jobs(p_after interval default interval '10 minutes')
returns table (requeued integer, failed integer)
language plpgsql security definer set search_path = public as $$
declare
  n_requeued integer;
  n_failed integer;
begin
  with stale as (
    update publish_jobs
       set status = 'queued', uncertain = true, run_at = now(),
           last_error = 'The publishing worker stopped before finishing; checking Pinterest before retrying.'
     where status = 'running' and coalesce(claimed_at, started_at) < now() - p_after and attempts < max_attempts
    returning 1)
  select count(*) into n_requeued from stale;

  with dead as (
    update publish_jobs
       set status = 'failed', uncertain = true, finished_at = now(),
           last_error = 'The publishing worker stopped and no attempts are left. Check Pinterest before trying again.'
     where status = 'running' and coalesce(claimed_at, started_at) < now() - p_after and attempts >= max_attempts
    returning draft_id),
  back as (
    update pin_drafts d
       set status = 'approved', scheduled_for = null,
           review_note = 'Publishing was interrupted. Check Pinterest for this pin before publishing again.'
      from dead where d.id = dead.draft_id and d.status = 'scheduled'
    returning 1)
  select (select count(*) from dead) into n_failed;

  return query select n_requeued, n_failed;
end $$;
revoke all on function public.recover_stale_publish_jobs from public, anon, authenticated;
grant execute on function public.recover_stale_publish_jobs to service_role;
