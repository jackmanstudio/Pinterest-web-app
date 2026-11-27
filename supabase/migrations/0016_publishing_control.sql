-- Publishing control: pause/resume the queue per account, the user's timezone
-- on each schedule, a lock so only one request refreshes a Pinterest token at
-- a time, and a heartbeat so the app can show when the worker last ran.
-- Safe to run more than once. The app keeps working (without these extras)
-- until it is run.

-- Pause / resume the publishing queue of one account.
alter table public.workspaces add column if not exists publishing_paused boolean not null default false;

-- The timezone the user picked the time in (run_at itself is stored in UTC).
alter table public.publish_jobs add column if not exists timezone text
  check (timezone is null or char_length(timezone) <= 64);

-- Only one refresh of a Pinterest token at a time (refresh tokens rotate).
alter table public.pinterest_connections add column if not exists refresh_lock_until timestamptz;

create or replace function public.claim_token_refresh(p_ws uuid, p_for interval default interval '60 seconds')
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update pinterest_connections
     set refresh_lock_until = now() + p_for
   where workspace_id = p_ws and (refresh_lock_until is null or refresh_lock_until < now());
  return found;
end $$;
revoke all on function public.claim_token_refresh from public, anon, authenticated;
grant execute on function public.claim_token_refresh to service_role;

create or replace function public.release_token_refresh(p_ws uuid)
returns void
language sql security definer set search_path = public as $$
  update pinterest_connections set refresh_lock_until = null where workspace_id = p_ws;
$$;
revoke all on function public.release_token_refresh from public, anon, authenticated;
grant execute on function public.release_token_refresh to service_role;

-- Last run of each background worker (server only; no browser access).
create table if not exists public.worker_runs (
  name text primary key check (char_length(name) <= 64),
  last_run_at timestamptz not null default now(),
  last_ok boolean not null default true,
  last_result jsonb not null default '{}'::jsonb
);
alter table public.worker_runs enable row level security;
