-- Unlimited accounts per user.
-- Until now every user had exactly two workspaces (Fashion + Macro), one per
-- workspace_kind. Now a user can add any number of accounts (each with its own
-- Pinterest connection, boards, pins, brand and settings):
--   * workspaces.slug is the account's URL id (/w/<slug>), unique per user.
--   * workspaces.kind stays as the account's niche template (starter
--     categories, sample boards, image look); many accounts can share one.
-- Existing workspaces keep their URLs: slug = 'fashion' / 'macro'.
-- Board categories: board_settings.board_categories keeps the category the
-- user picked for a board (board_id -> category); boards without a pick use
-- the auto-detected category.

alter table public.workspaces add column if not exists slug text;
update public.workspaces set slug = kind::text where slug is null;
alter table public.workspaces alter column slug set not null;
alter table public.workspaces drop constraint if exists workspaces_slug_format;
alter table public.workspaces add constraint workspaces_slug_format
  check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');
alter table public.workspaces drop constraint if exists workspaces_name_length;
alter table public.workspaces add constraint workspaces_name_length
  check (char_length(btrim(name)) between 1 and 60) not valid;
alter table public.workspaces drop constraint if exists workspaces_owner_id_kind_key;
alter table public.workspaces drop constraint if exists workspaces_owner_slug_key;
-- Also the index for "all of my accounts" (owner_id leads).
alter table public.workspaces add constraint workspaces_owner_slug_key unique (owner_id, slug);

-- New sign-ups still get the two starter accounts, now with slugs.
create or replace function public.bootstrap_user_workspaces() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fashion_id uuid;
  macro_id uuid;
begin
  insert into workspaces (owner_id, kind, slug, name) values (new.id, 'fashion', 'fashion', 'Fashion') returning id into fashion_id;
  insert into workspaces (owner_id, kind, slug, name) values (new.id, 'macro', 'macro', 'Macro') returning id into macro_id;
  insert into brand_settings (workspace_id) values (fashion_id), (macro_id);
  insert into categories (workspace_id, name)
    select fashion_id, unnest(public.default_category_names('fashion'));
  insert into categories (workspace_id, name)
    select macro_id, unnest(public.default_category_names('macro'));
  return new;
end $$;

-- Add an account for the signed-in user. The slug comes from the name and is
-- made unique ("recipes", "recipes-2", ...). Returns the new workspace row.
create or replace function public.create_workspace(p_name text, p_niche workspace_kind default 'macro')
returns public.workspaces
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(coalesce(p_name, ''));
  base text;
  candidate text;
  n int := 1;
  ws public.workspaces;
begin
  if uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if char_length(clean) < 1 or char_length(clean) > 60 then
    raise exception 'Account name must be 1 to 60 characters' using errcode = '22023';
  end if;
  base := left(btrim(regexp_replace(lower(clean), '[^a-z0-9]+', '-', 'g'), '-'), 36);
  base := btrim(base, '-');
  if base = '' then base := 'account'; end if;
  candidate := base;
  -- Serialise account creation per user so two tabs can't race for one slug.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 13));
  while exists (select 1 from workspaces where owner_id = uid and slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  insert into workspaces (owner_id, kind, slug, name) values (uid, p_niche, candidate, clean) returning * into ws;
  insert into brand_settings (workspace_id) values (ws.id);
  insert into categories (workspace_id, name) select ws.id, unnest(public.default_category_names(p_niche));
  return ws;
end $$;
revoke all on function public.create_workspace(text, workspace_kind) from public, anon;
grant execute on function public.create_workspace(text, workspace_kind) to authenticated;

-- Delete one of your accounts and everything in it (pins, boards, Pinterest
-- connection, settings). Your last account can't be deleted.
create or replace function public.delete_workspace(p_workspace uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 13));
  if not exists (select 1 from workspaces where id = p_workspace and owner_id = uid) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if (select count(*) from workspaces where owner_id = uid) <= 1 then
    raise exception 'You need at least one account' using errcode = '22023';
  end if;
  delete from workspaces where id = p_workspace and owner_id = uid;
end $$;
revoke all on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.delete_workspace(uuid) to authenticated;

-- Board categories picked by the user (board_id -> category name).
alter table public.board_settings
  add column if not exists board_categories jsonb not null default '{}'::jsonb;
alter table public.board_settings drop constraint if exists board_settings_board_categories_check;
alter table public.board_settings add constraint board_settings_board_categories_check
  check (jsonb_typeof(board_categories) = 'object');
