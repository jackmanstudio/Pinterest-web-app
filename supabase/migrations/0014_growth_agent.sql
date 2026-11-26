-- Growth agent: reads the account's own Pinterest data and suggests new pin
-- ideas. It never publishes. A suggestion only reaches the Autopilot queue
-- after the owner accepts it (server-side, after an ownership check).

create table public.agent_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  growth_enabled boolean not null default false,
  ideas_per_run integer not null default 5 check (ideas_per_run between 1 and 6),
  updated_at timestamptz not null default now()
);
alter table public.agent_settings enable row level security;
create policy agent_settings_all on public.agent_settings for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create trigger agent_settings_touch before update on public.agent_settings
  for each row execute function public.touch_updated_at();

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent text not null default 'growth' check (agent in ('growth')),
  trigger text not null check (trigger in ('manual', 'schedule')),
  status text not null check (status in ('ok', 'skipped', 'failed')),
  provider text,
  model text,
  snapshot_ids uuid[] not null default '{}',
  kept integer not null default 0,
  dropped integer not null default 0,
  detail text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index agent_runs_ws_idx on public.agent_runs (workspace_id, agent, created_at desc);
alter table public.agent_runs enable row level security;
create policy agent_runs_select on public.agent_runs for select using (public.owns_workspace(workspace_id));

create table public.agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  agent text not null default 'growth' check (agent in ('growth')),
  idea text not null check (char_length(idea) between 3 and 500),
  reason text check (reason is null or char_length(reason) <= 500),
  evidence text check (evidence is null or char_length(evidence) <= 500),
  signal text not null check (signal in ('top_pin', 'trend', 'account', 'gap')),
  ref text check (ref is null or char_length(ref) <= 200),
  status text not null default 'suggested' check (status in ('suggested', 'accepted', 'dismissed')),
  idea_id uuid references public.autopilot_ideas (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index agent_suggestions_ws_idx on public.agent_suggestions (workspace_id, status, created_at desc);
alter table public.agent_suggestions enable row level security;
-- Owners read their suggestions; all writes go through the server.
create policy agent_suggestions_select on public.agent_suggestions for select using (public.owns_workspace(workspace_id));
