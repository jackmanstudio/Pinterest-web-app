-- Spec 12: profiles.
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
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'p1@test', '{"full_name":"  Ayesha Khan ","terms_accepted":"true"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'p2@test', '{}');
select pg_temp.check((select full_name = 'Ayesha Khan' and terms_accepted_at is not null from profiles where id = '00000000-0000-0000-0000-0000000000e1'), 'signup creates a profile with name and terms time');
select pg_temp.check((select terms_accepted_at is null from profiles where id = '00000000-0000-0000-0000-0000000000e2'), 'no terms time without acceptance');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select pg_temp.check((select count(*) from profiles) = 1, 'users see only their own profile');
update profiles set full_name = 'Ayesha K', notify_weekly_summary = true;
select pg_temp.check((select full_name = 'Ayesha K' and notify_weekly_summary from profiles), 'owner can update name and notifications');
select pg_temp.check(pg_temp.fails($$update profiles set terms_accepted_at = now() - interval '1 year'$$), 'terms time cannot be rewritten');
select pg_temp.check(pg_temp.fails($$update profiles set full_name = repeat('x', 101)$$), 'name length is limited');
update profiles set full_name = 'hacked' where id = '00000000-0000-0000-0000-0000000000e2';
select pg_temp.check(pg_temp.fails($$insert into profiles (id) values ('00000000-0000-0000-0000-0000000000e9')$$), 'users cannot insert profiles');

select pg_temp.as_admin();
select pg_temp.check((select full_name = '' from profiles where id = '00000000-0000-0000-0000-0000000000e2'), 'users cannot change other profiles');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e2';
select pg_temp.check(not exists (select 1 from profiles where id = '00000000-0000-0000-0000-0000000000e2'), 'deleting the user deletes the profile');

reset role;
\echo PROFILE TESTS PASSED
