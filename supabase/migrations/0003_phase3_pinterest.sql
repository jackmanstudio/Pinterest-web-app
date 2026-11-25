-- Pinterest AI Studio — Phase 3: Pinterest OAuth connections + read-only sync
-- One Pinterest account per workspace. Tokens are AES-256-GCM encrypted by the
-- server before storage AND the table has no user-facing policies: only the
-- server (service role) can read or write it. The server returns only safe
-- fields (never tokens) to the browser.

create table public.pinterest_connections (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  pinterest_user_id text,
  username text not null,
  account_type text,
  profile_image text,
  scopes text[] not null default '{}',
  access_token_enc text not null,
  refresh_token_enc text,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'needs_reconnect')),
  sync_status text not null default 'never' check (sync_status in ('never', 'running', 'ok', 'error')),
  sync_error text,
  sync_started_at timestamptz,
  last_synced_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pinterest_connections enable row level security;
-- (no policies on purpose: anon/authenticated roles can't read tokens)

create trigger pinterest_connections_touch before update on public.pinterest_connections
  for each row execute function public.touch_updated_at();

create table public.pinterest_boards (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  board_id text not null,
  name text not null,
  description text,
  privacy text,
  pin_count integer,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, board_id)
);

create table public.pinterest_pins (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pin_id text not null,
  board_id text,
  title text,
  description text,
  link text,
  alt_text text,
  image_url text,
  pin_created_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, pin_id)
);
create index pinterest_pins_ws_created_idx on public.pinterest_pins (workspace_id, pin_created_at desc);

alter table public.pinterest_boards enable row level security;
alter table public.pinterest_pins enable row level security;
-- Read-only for owners; only the server writes synced data.
create policy pinterest_boards_select on public.pinterest_boards for select using (public.owns_workspace(workspace_id));
create policy pinterest_pins_select on public.pinterest_pins for select using (public.owns_workspace(workspace_id));
