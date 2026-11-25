-- Pinterest AI Studio — spec v1.8 gaps: 40-category taxonomy, pin library
-- (archive, duplicates), version history, and extra brand profile fields.

-- 1. Category taxonomy (spec section 6) --------------------------------------
-- Macro starts with all 40 categories, Fashion with the first ten.
-- Keep in sync with src/lib/categories/taxonomy.ts.
create or replace function public.default_category_names(k workspace_kind) returns text[]
language sql immutable as $$
  select case when k = 'macro' then names else names[1:10] end
  from (select array[
    'Women''s Fashion',
    'Men''s Fashion',
    'Kids & Baby Fashion',
    'Modest Fashion',
    'Streetwear & Urban Style',
    'Luxury & Designer Fashion',
    'Shoes & Footwear',
    'Bags & Handbags',
    'Jewelry & Watches',
    'Fashion Trends & Outfit Inspiration',
    'Makeup',
    'Skincare',
    'Haircare & Hairstyles',
    'Nails & Nail Art',
    'Fragrance & Perfumes',
    'Interior Design',
    'Home Decor',
    'Architecture',
    'Real Estate & Property',
    'Home Organization',
    'DIY & Home Improvement',
    'Recipes & Cooking',
    'Baking & Desserts',
    'Parenting & Baby Care',
    'Weddings & Celebrations',
    'Travel & Destinations',
    'Fitness & Exercise',
    'Gardening & Plants',
    'Pets & Animals',
    'Photography & Videography',
    'Entrepreneurship & Online Business',
    'Digital Marketing & Social Media',
    'Technology & Gadgets',
    'Graphic Design & Digital Products',
    'Personal Development & Productivity',
    'Mental Health & Mindfulness',
    'Healthy Eating & Nutrition',
    'Weight Loss & Body Wellness',
    'Sleep & Recovery',
    'Self-Care & Daily Wellness'
  ]::text[] as names) t;
$$;

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
    select fashion_id, unnest(public.default_category_names('fashion'));
  insert into categories (workspace_id, name)
    select macro_id, unnest(public.default_category_names('macro'));
  return new;
end $$;

-- Backfill existing workspaces: add any missing spec category, keep the user's own.
insert into public.categories (workspace_id, name)
select w.id, n.name
  from public.workspaces w
  cross join lateral unnest(public.default_category_names(w.kind)) as n(name)
 where not exists (
   select 1 from public.categories c
    where c.workspace_id = w.id and c.parent_id is null and lower(c.name) = lower(n.name)
 );

-- 2. Pin library: archive + intentional duplicates ---------------------------
alter table public.pin_drafts
  add column archived_at timestamptz,
  add column duplicate_of uuid;
alter table public.pin_drafts
  add constraint pin_drafts_duplicate_same_ws
  foreign key (duplicate_of) references public.pin_drafts (id) on delete set null;
create index pin_drafts_ws_archived_idx on public.pin_drafts (workspace_id) where archived_at is null;

create or replace function public.guard_draft_archive() returns trigger
language plpgsql as $$
begin
  if new.archived_at is not null and (tg_op = 'INSERT' or old.archived_at is null)
     and new.status = 'scheduled' then
    raise exception 'cancel the schedule before archiving this pin';
  end if;
  if tg_op = 'INSERT' and new.duplicate_of is not null and not exists (
    select 1 from public.pin_drafts p where p.id = new.duplicate_of and p.workspace_id = new.workspace_id
  ) then
    raise exception 'a draft can only duplicate a draft from the same workspace';
  end if;
  return new;
end $$;
create trigger pin_drafts_guard_archive before insert or update on public.pin_drafts
  for each row execute function public.guard_draft_archive();

-- 3. Version history of draft text (spec 24.7) -------------------------------
create table public.pin_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.pin_drafts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  description text not null,
  tags text[] not null,
  alt_text text not null,
  concept text not null,
  image_prompt text not null,
  link text,
  changed_by text not null check (changed_by in ('you', 'autopilot', 'server')),
  created_at timestamptz not null default now()
);
create index pin_draft_versions_draft_idx on public.pin_draft_versions (draft_id, created_at desc);
alter table public.pin_draft_versions enable row level security;
-- Read-only for owners; rows are written only by the trigger below.
create policy pin_draft_versions_select on public.pin_draft_versions for select using (public.owns_workspace(workspace_id));

create or replace function public.snapshot_draft_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.title, new.description, new.tags, new.alt_text, new.concept, new.image_prompt, new.link)
     is distinct from (old.title, old.description, old.tags, old.alt_text, old.concept, old.image_prompt, old.link) then
    insert into pin_draft_versions (draft_id, workspace_id, title, description, tags, alt_text, concept, image_prompt, link, changed_by)
    values (old.id, old.workspace_id, old.title, old.description, old.tags, old.alt_text, old.concept, old.image_prompt, old.link,
            case when auth.role() = 'authenticated' then 'you' when old.autopilot then 'autopilot' else 'server' end);
    -- Keep the 30 most recent versions per draft.
    delete from pin_draft_versions v
     where v.draft_id = old.id
       and v.id not in (select id from pin_draft_versions where draft_id = old.id order by created_at desc, id limit 30);
  end if;
  return new;
end $$;
create trigger pin_drafts_snapshot after update on public.pin_drafts
  for each row execute function public.snapshot_draft_version();

-- 4. Brand profile extras (spec 5.3) -----------------------------------------
alter table public.brand_settings
  add column image_style text not null default '' check (char_length(image_style) <= 120),
  add column cta text not null default '' check (char_length(cta) <= 120),
  add column language text not null default '' check (char_length(language) <= 40),
  add column region text not null default '' check (char_length(region) <= 60);

-- Display names stay short and non-empty.
alter table public.workspaces add constraint workspaces_name_len check (char_length(btrim(name)) between 1 and 40);
