-- Pinterest AI Studio — Phase 4: approval workflow, publish jobs, audit log
--
-- Workflow: draft -> in_review -> approved -> scheduled -> published
-- Browsers may only move draft <-> in_review. Every other transition happens
-- in server routes (service role) after an explicit user action, and is
-- recorded in audit_events.

alter table public.pin_drafts
  add column link text check (link is null or char_length(link) <= 2048),
  add column board_id text,
  add column board_name text,
  add column review_note text,
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users (id),
  add column scheduled_for timestamptz,
  add column published_at timestamptz,
  add column external_pin_id text;

create type publish_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create table public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  draft_id uuid not null references public.pin_drafts (id) on delete cascade,
  board_id text not null,
  board_name text,
  run_at timestamptz not null,
  status publish_job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  -- true when a previous attempt may have reached Pinterest (timeout / 5xx);
  -- the runner then checks Pinterest for the pin before trying again.
  uncertain boolean not null default false,
  last_error text,
  external_pin_id text,
  created_by uuid references auth.users (id),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
-- At most one live or successful job per draft: the database itself prevents duplicate pins.
create unique index publish_jobs_one_per_draft on public.publish_jobs (draft_id)
  where status in ('queued', 'running', 'succeeded');
create index publish_jobs_due_idx on public.publish_jobs (run_at) where status = 'queued';

alter table public.publish_jobs enable row level security;
create policy publish_jobs_select on public.publish_jobs for select using (public.owns_workspace(workspace_id));

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id),
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_ws_created_idx on public.audit_events (workspace_id, created_at desc);
alter table public.audit_events enable row level security;
create policy audit_events_select on public.audit_events for select using (public.owns_workspace(workspace_id));

-- Replace the Phase 1 status guard with the full browser-side rules.
create or replace function public.guard_draft_status() returns trigger
language plpgsql as $$
declare
  content_changed boolean;
begin
  if auth.role() <> 'authenticated' then
    return new; -- server (service role) paths enforce their own rules
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_at is not null or new.external_pin_id is not null or new.scheduled_for is not null then
      raise exception 'new drafts must start as plain drafts';
    end if;
    return new;
  end if;

  if new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by
     or new.scheduled_for is distinct from old.scheduled_for or new.published_at is distinct from old.published_at
     or new.external_pin_id is distinct from old.external_pin_id or new.board_id is distinct from old.board_id
     or new.board_name is distinct from old.board_name then
    raise exception 'approval and publishing fields can only be set by the server';
  end if;

  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status = 'in_review') or (old.status = 'in_review' and new.status = 'draft')) then
    raise exception 'status % -> % can only be set by the server', old.status, new.status;
  end if;

  content_changed := (new.title, new.description, new.tags, new.alt_text, new.image_prompt, new.concept, new.link, new.image_path)
    is distinct from (old.title, old.description, old.tags, old.alt_text, old.image_prompt, old.concept, old.link, old.image_path);

  if content_changed then
    if old.status in ('scheduled', 'published') then
      raise exception 'this pin is % and is locked; cancel the schedule first', old.status;
    end if;
    if old.status = 'approved' then
      -- Editing approved content withdraws the approval.
      new.status := 'draft';
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;
  return new;
end $$;

-- Atomic claim used by the publish runner (server only).
create or replace function public.claim_publish_job(p_job uuid) returns setof public.publish_jobs
language sql security definer set search_path = public as $$
  update public.publish_jobs
     set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now())
   where id = p_job and status = 'queued' and run_at <= now() and attempts < max_attempts
  returning *;
$$;
revoke all on function public.claim_publish_job from public, anon, authenticated;
grant execute on function public.claim_publish_job to service_role;
