-- Test fixture only (never a migration): give each test user two accounts,
-- slugs 'fashion' and 'macro', so the older RLS tests keep their setup.
-- Real users start with no accounts. Users whose email ends in '@noseed'
-- get none, like real sign-ups.
create or replace function public.test_seed_accounts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f uuid;
  m uuid;
begin
  if new.email like '%@noseed' then return new; end if;
  insert into workspaces (owner_id, kind, slug, name) values (new.id, 'fashion', 'fashion', 'Fashion') returning id into f;
  insert into workspaces (owner_id, kind, slug, name) values (new.id, 'macro', 'macro', 'Macro') returning id into m;
  insert into brand_settings (workspace_id) values (f), (m);
  insert into categories (workspace_id, name) select f, unnest(public.default_category_names('fashion'));
  insert into categories (workspace_id, name) select m, unnest(public.default_category_names('macro'));
  return new;
end $$;
create trigger test_seed_accounts after insert on auth.users
  for each row execute function public.test_seed_accounts();
