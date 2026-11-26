-- Unlimited accounts per user, and board categories.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end $$;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;
create or replace function pg_temp.fails(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;

select pg_temp.as_admin();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b7', 'ua@noseed'), ('00000000-0000-0000-0000-0000000000b8', 'ua2@noseed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select pg_temp.check((select count(*) from workspaces) = 0, 'new users start with no accounts');
select pg_temp.check(not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created'), 'no built-in accounts are created on sign-up');

select public.create_workspace('Kitchen Recipes', 'macro');
select public.create_workspace('Kitchen Recipes!', 'macro');
select public.create_workspace('Abaya Shop', 'fashion');
select public.create_workspace('Travel Spots', 'macro');
select public.create_workspace('Home Decor', 'macro');
select pg_temp.check((select count(*) from workspaces) = 5, 'a user can add any number of accounts');
select pg_temp.check((select array_agg(slug order by slug) from workspaces where name like 'Kitchen%') = '{kitchen-recipes,kitchen-recipes-2}', 'slugs are unique per user');
select pg_temp.check((select count(*) from categories c join workspaces w on w.id = c.workspace_id where w.slug = 'abaya-shop') = 10, 'a fashion account gets the fashion starter categories');
select pg_temp.check((select count(*) from brand_settings b join workspaces w on w.id = b.workspace_id where w.slug = 'kitchen-recipes') = 1, 'a new account gets its own brand settings');
select pg_temp.check(pg_temp.fails($$select public.create_workspace('   ')$$), 'an account needs a name');
select pg_temp.check(pg_temp.fails($$update workspaces set slug = 'Bad Slug!' where slug = 'abaya-shop'$$), 'slugs must be URL-safe');
select pg_temp.check(pg_temp.fails($$insert into workspaces (owner_id, kind, slug, name) values ('00000000-0000-0000-0000-0000000000b8', 'macro', 'x', 'x')$$), 'users cannot create accounts for someone else');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b8');
select public.create_workspace('Kitchen Recipes', 'macro');
select pg_temp.check((select count(*) from workspaces) = 1 and (select count(*) from workspaces where slug = 'kitchen-recipes') = 1, 'two users can use the same slug and only see their own accounts');
select pg_temp.check(pg_temp.fails($$select public.delete_workspace((select id from workspaces where false))$$), 'deleting an unknown account fails');
create temp table other_ws as select id from workspaces where slug = 'kitchen-recipes';
grant select on other_ws to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select pg_temp.check(pg_temp.fails($$select public.delete_workspace((select id from other_ws))$$), 'users cannot delete someone else''s account');
select public.delete_workspace((select id from workspaces where slug = 'kitchen-recipes-2'));
select pg_temp.check((select count(*) from workspaces) = 4, 'a user can delete one of their accounts');
select public.delete_workspace(id) from workspaces where slug in ('kitchen-recipes', 'abaya-shop', 'travel-spots');
select pg_temp.check((select count(*) from workspaces) = 1, 'deleting several accounts works');

insert into board_settings (workspace_id, board_categories) select id, '{"123": "Recipes & Food"}' from workspaces where slug = 'home-decor';
select pg_temp.check((select board_categories->>'123' = 'Recipes & Food' from board_settings), 'board categories can be saved');
select pg_temp.check(pg_temp.fails($$update board_settings set board_categories = '[]'$$), 'board categories must be an object');

select public.delete_workspace((select id from workspaces where slug = 'home-decor'));
select pg_temp.check((select count(*) from workspaces) = 0, 'the last account can be deleted too');

reset role;
\echo UNLIMITED ACCOUNTS TESTS PASSED
