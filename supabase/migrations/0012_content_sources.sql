-- Competitor gap 1 & 4: pins from your own pages, and content auto-sync.
-- An idea can now carry the page it promotes (link), facts read from that
-- page (context) and its photos. Content sources (RSS/Atom feeds, sitemaps,
-- Shopify stores) feed new pages into the Autopilot queue.

alter table public.autopilot_ideas
  add column if not exists link text check (link is null or char_length(link) <= 2048),
  add column if not exists context text check (context is null or char_length(context) <= 2000),
  add column if not exists image_urls text[] not null default '{}' check (cardinality(image_urls) <= 6);

alter table public.autopilot_ideas drop constraint if exists autopilot_ideas_source_check;
alter table public.autopilot_ideas add constraint autopilot_ideas_source_check check (source in ('user', 'trends', 'agent', 'feed'));

create table public.content_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2048),
  kind text check (kind in ('feed', 'sitemap', 'shopify')),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, url)
);
alter table public.content_sources enable row level security;
create policy content_sources_all on public.content_sources for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

create or replace function public.limit_content_sources() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from content_sources where workspace_id = new.workspace_id) >= 10 then
    raise exception 'at most 10 content sources per account';
  end if;
  return new;
end $$;
create trigger content_sources_limit before insert on public.content_sources
  for each row execute function public.limit_content_sources();
