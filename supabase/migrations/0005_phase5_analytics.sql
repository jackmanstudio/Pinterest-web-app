-- Pinterest AI Studio — Phase 5: analytics snapshots + AI insights
-- Every number shown in the app comes from a stored snapshot of a Pinterest
-- API response, with its endpoint, date range and fetch time.

create table public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('account', 'top_pins', 'published_pins', 'trends')),
  source text not null,          -- e.g. "Pinterest API v5 GET /user_account/analytics"
  environment text not null,     -- sandbox | production
  start_date date,
  end_date date,
  params jsonb not null default '{}',
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
create index analytics_snapshots_ws_kind_idx on public.analytics_snapshots (workspace_id, kind, fetched_at desc);
alter table public.analytics_snapshots enable row level security;
create policy analytics_snapshots_select on public.analytics_snapshots for select using (public.owns_workspace(workspace_id));

create table public.analytics_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  snapshot_ids uuid[] not null,
  provider text not null,
  model text,
  insights jsonb not null,
  dropped integer not null default 0,
  created_at timestamptz not null default now()
);
create index analytics_insights_ws_idx on public.analytics_insights (workspace_id, created_at desc);
alter table public.analytics_insights enable row level security;
create policy analytics_insights_select on public.analytics_insights for select using (public.owns_workspace(workspace_id));
