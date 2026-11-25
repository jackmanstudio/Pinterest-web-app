-- Content sources and page ideas.
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7', 'cs@test'), ('00000000-0000-0000-0000-0000000000a8', 'cs2@test');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
create temp table cs_ws as select id from workspaces where kind = 'fashion';
insert into content_sources (workspace_id, url, kind) select id, 'https://blog.example/feed', 'feed' from cs_ws;
select pg_temp.check((select count(*) = 1 from content_sources), 'owner can add a content source');
select pg_temp.check(pg_temp.fails($$insert into content_sources (workspace_id, url) select id, 'https://blog.example/feed' from cs_ws$$), 'the same source cannot be added twice');
insert into content_sources (workspace_id, url) select id, 'https://s' || g || '.example/feed' from cs_ws, generate_series(1, 9) g;
select pg_temp.check(pg_temp.fails($$insert into content_sources (workspace_id, url) select id, 'https://eleven.example/feed' from cs_ws$$), 'at most 10 sources per account');
insert into autopilot_ideas (workspace_id, idea, link, context, image_urls) select id, 'Linen dress', 'https://shop.example/p', 'Price 49', '{https://shop.example/a.jpg}' from cs_ws;
select pg_temp.check((select link = 'https://shop.example/p' and cardinality(image_urls) = 1 from autopilot_ideas), 'owner can queue a page idea with link and photos');
select pg_temp.check(pg_temp.fails($$insert into autopilot_ideas (workspace_id, idea, source) select id, 'x feed', 'feed' from cs_ws$$), 'users cannot fake feed ideas');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a8');
select pg_temp.check((select count(*) from content_sources) = 0, 'other users cannot see content sources');

select pg_temp.as_admin();
insert into autopilot_ideas (workspace_id, idea, source, ref) select id, 'New post', 'feed', md5('https://blog.example/p') from cs_ws;
select pg_temp.check((select count(*) = 1 from autopilot_ideas where source = 'feed'), 'the server can queue feed ideas');

reset role;
\echo CONTENT SOURCE TESTS PASSED
