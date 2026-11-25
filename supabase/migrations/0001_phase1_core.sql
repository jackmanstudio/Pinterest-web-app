-- Pinterest AI Studio — Phase 1 core schema
-- Workspaces (Fashion / Macro) are isolated per owner with row-level security.
-- Every workspace-scoped table carries workspace_id, and cross-workspace
-- references are blocked with composite foreign keys.

create extension if not exists pgcrypto;

create type workspace_kind as enum ('fashion', 'macro');
create type draft_status as enum ('draft', 'in_review', 'approved', 'scheduled', 'published');
create type image_status as enum ('not_generated', 'pending', 'ready', 'failed');
create type content_source as enum ('demo', 'ai', 'manual');

-- Workspaces ---------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind workspace_kind not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, kind),
  unique (id, owner_id)
);

-- Brand settings (one row per workspace) -----------------------------------
create table public.brand_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  brand_name text not null default '',
  voice text not null default '',
  audience text not null default '',
  website_url text not null default '',
  focus_keywords text[] not null default '{}',
  banned_words text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Category taxonomy ---------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, parent_id, name),
  -- a parent must live in the same workspace
  foreign key (parent_id, workspace_id) references public.categories (id, workspace_id) on delete cascade
);

-- Pin drafts ----------------------------------------------------------------
create table public.pin_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  category_id uuid,
  batch_id uuid not null,
  idea text not null check (char_length(idea) between 1 and 500),
  angle text not null default '',
  concept text not null default '',
  title text not null default '' check (char_length(title) <= 100),
  description text not null default '' check (char_length(description) <= 500),
  tags text[] not null default '{}',
  alt_text text not null default '' check (char_length(alt_text) <= 500),
  image_prompt text not null default '',
  image_status image_status not null default 'not_generated',
  status draft_status not null default 'draft',
  source content_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- category must belong to the same workspace as the draft
  foreign key (category_id, workspace_id) references public.categories (id, workspace_id) on delete set null (category_id)
);
create index pin_drafts_workspace_created_idx on public.pin_drafts (workspace_id, created_at desc);

-- updated_at trigger --------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger brand_settings_touch before update on public.brand_settings
  for each row execute function public.touch_updated_at();
create trigger pin_drafts_touch before update on public.pin_drafts
  for each row execute function public.touch_updated_at();

-- Row-level security --------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.brand_settings enable row level security;
alter table public.categories enable row level security;
alter table public.pin_drafts enable row level security;

create or replace function public.owns_workspace(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = auth.uid());
$$;

-- Workspaces are created by the signup trigger only; users can read and rename.
create policy workspaces_select on public.workspaces for select using (owner_id = auth.uid());
create policy workspaces_update on public.workspaces for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy brand_settings_all on public.brand_settings for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy categories_all on public.categories for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy pin_drafts_all on public.pin_drafts for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

-- Phase 1 only allows the 'draft' status from the client. Later phases move
-- drafts through review/approval via server routes, not direct client writes.
create or replace function public.guard_draft_status() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'authenticated' and new.status not in ('draft', 'in_review') then
    raise exception 'status % can only be set by the server', new.status;
  end if;
  return new;
end $$;
create trigger pin_drafts_status_guard before insert or update on public.pin_drafts
  for each row execute function public.guard_draft_status();

-- Bootstrap: every new user gets Fashion + Macro workspaces, brand settings
-- and a starter category taxonomy.
create or replace function public.bootstrap_user_workspaces() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fashion_id uuid;
  macro_id uuid;
begin
  insert into workspaces (owner_id, kind, name) values (new.id, 'fashion', 'Fashion') returning id into fashion_id;
  insert into workspaces (owner_id, kind, name) values (new.id, 'macro', 'Macro') returning id into macro_id;
  insert into brand_settings (workspace_id) values (fashion_id), (macro_id);
  insert into categories (workspace_id, name)
    select fashion_id, unnest(array['Outfit ideas', 'Seasonal trends', 'Accessories', 'Styling tips', 'Capsule wardrobe']);
  -- Macro categories are left for the user to define in Settings.
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.bootstrap_user_workspaces();
