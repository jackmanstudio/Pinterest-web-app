-- Phase 7: Autopilot. Off by default. When the owner turns it on (typing the
-- consent phrase), a scheduled server job turns queued ideas into pins and
-- publishes them to Pinterest without per-pin approval, within a daily limit
-- and the monthly AI budget. Designed to grow into a fully automatic agent:
-- `idea_source` and `autopilot_ideas.source` leave room for trend-sourced ideas.

create table public.autopilot_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  enabled boolean not null default false,
  consent_text text,
  board_id text,
  board_name text,
  pins_per_day integer not null default 3 check (pins_per_day between 1 and 10),
  link text check (link is null or link ~* '^https?://'),
  idea_source text not null default 'queue' check (idea_source in ('queue')),
  enabled_at timestamptz,
  enabled_by uuid references auth.users (id) on delete set null,
  paused_reason text,
  last_run_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Turning it on is only possible with the exact consent phrase and a board.
  constraint autopilot_consent check (not enabled or (consent_text is not distinct from 'AUTO PUBLISH' and board_id is not null))
);

alter table public.autopilot_settings enable row level security;
create policy autopilot_settings_all on public.autopilot_settings for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create trigger autopilot_settings_touch before update on public.autopilot_settings
  for each row execute function public.touch_updated_at();

-- Record who switched it on and when; switching off clears the consent.
create or replace function public.autopilot_stamp() returns trigger
language plpgsql as $$
begin
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.enabled_at := now();
    new.enabled_by := coalesce(auth.uid(), new.enabled_by);
    new.paused_reason := null;
  elsif not new.enabled then
    new.consent_text := null;
  end if;
  return new;
end $$;
create trigger autopilot_settings_stamp before insert or update on public.autopilot_settings
  for each row execute function public.autopilot_stamp();

create type autopilot_idea_status as enum ('queued', 'processing', 'done', 'failed');

create table public.autopilot_ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  idea text not null check (char_length(idea) between 3 and 500),
  source text not null default 'user' check (source in ('user', 'trends', 'agent')),
  status autopilot_idea_status not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index autopilot_ideas_queue_idx on public.autopilot_ideas (workspace_id, status, created_at);

alter table public.autopilot_ideas enable row level security;
create policy autopilot_ideas_select on public.autopilot_ideas for select using (public.owns_workspace(workspace_id));
-- Users can only add plain queued ideas and delete ones not yet started.
create policy autopilot_ideas_insert on public.autopilot_ideas for insert
  with check (public.owns_workspace(workspace_id) and status = 'queued' and source = 'user');
create policy autopilot_ideas_delete on public.autopilot_ideas for delete
  using (public.owns_workspace(workspace_id) and status in ('queued', 'failed', 'done'));

-- Drafts created by Autopilot are marked; only the server can set the mark.
alter table public.pin_drafts add column autopilot boolean not null default false;

create or replace function public.guard_draft_autopilot() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and (
    (tg_op = 'INSERT' and new.autopilot) or (tg_op = 'UPDATE' and new.autopilot is distinct from old.autopilot)
  ) then
    raise exception 'only the server can mark drafts as autopilot';
  end if;
  return new;
end $$;
create trigger pin_drafts_guard_autopilot before insert or update on public.pin_drafts
  for each row execute function public.guard_draft_autopilot();

-- Atomically take the oldest queued idea (one runner wins).
create or replace function public.claim_autopilot_idea(p_workspace uuid) returns setof public.autopilot_ideas
language sql security definer set search_path = public as $$
  update autopilot_ideas set status = 'processing'
  where id = (
    select id from autopilot_ideas
    where workspace_id = p_workspace and status = 'queued'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;
revoke execute on function public.claim_autopilot_idea from public, anon, authenticated;
grant execute on function public.claim_autopilot_idea to service_role;
