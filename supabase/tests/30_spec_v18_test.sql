-- Spec v1.8: taxonomy, archive, duplicates, version history, brand extras.
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'c@test');
select pg_temp.check((select count(*) from categories c join workspaces w on w.id = c.workspace_id
  where w.owner_id = '00000000-0000-0000-0000-0000000000c1' and w.kind = 'macro') = 40, 'new Macro workspace gets 40 categories');
select pg_temp.check(exists (select 1 from categories c join workspaces w on w.id = c.workspace_id
  where w.owner_id = '00000000-0000-0000-0000-0000000000c1' and w.kind = 'fashion' and c.name = 'Jewelry & Watches'), 'Fashion gets the 10 fashion categories');
select pg_temp.check(not exists (select 1 from categories c join workspaces w on w.id = c.workspace_id
  where w.owner_id = '00000000-0000-0000-0000-0000000000c1' and w.kind = 'fashion' and c.name = 'Makeup'), 'Fashion does not get the non-fashion categories');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
create temp table c_ws as select id from workspaces where kind = 'fashion';
create temp table m_ws as select id from workspaces where kind = 'macro';
insert into pin_drafts (workspace_id, batch_id, idea, title, description, source)
  select id, gen_random_uuid(), 'trench idea', 'Trench coat looks', 'First copy', 'manual' from c_ws;
update pin_drafts set title = 'Trench coat looks for autumn', description = 'Second copy';
select pg_temp.check((select count(*) from pin_draft_versions) = 1, 'editing a draft saves the previous version');
select pg_temp.check((select title = 'Trench coat looks' and changed_by = 'you' from pin_draft_versions), 'version keeps the old text and who changed it');
select pg_temp.check(pg_temp.fails($$insert into pin_draft_versions (draft_id, workspace_id, title, description, tags, alt_text, concept, image_prompt, changed_by)
  select id, workspace_id, 'x', 'x', '{}', '', '', '', 'you' from pin_drafts$$), 'users cannot write fake versions');

update pin_drafts set archived_at = now();
select pg_temp.check((select archived_at is not null from pin_drafts), 'owner can archive a draft');
insert into pin_drafts (workspace_id, batch_id, idea, title, source, duplicate_of)
  select workspace_id, gen_random_uuid(), idea, title || ' (copy)', 'manual', id from pin_drafts;
select pg_temp.check((select count(*) from pin_drafts where duplicate_of is not null) = 1, 'owner can duplicate a draft');
select pg_temp.check(pg_temp.fails($$insert into pin_drafts (workspace_id, batch_id, idea, title, source, duplicate_of)
  select (select id from m_ws), gen_random_uuid(), 'cross', 't', 'manual', id from pin_drafts limit 1$$), 'a duplicate cannot point into the other workspace');

update brand_settings set image_style = 'editorial photography', cta = 'Save for later', language = 'Urdu', region = 'Pakistan' where workspace_id = (select id from c_ws);
select pg_temp.check((select language = 'Urdu' from brand_settings where workspace_id = (select id from c_ws)), 'owner can set brand language and CTA');
update workspaces set name = 'Style Diary' where id = (select id from c_ws);
select pg_temp.check((select name = 'Style Diary' from workspaces where id = (select id from c_ws)), 'owner can rename the workspace');
select pg_temp.check(pg_temp.fails($$update workspaces set name = '  ' where id = (select id from c_ws)$$), 'workspace name cannot be blank');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from pin_draft_versions) = 0, 'other users cannot see version history');

select pg_temp.as_admin();
update pin_drafts set status = 'scheduled', archived_at = null where duplicate_of is not null;
select pg_temp.check(pg_temp.fails($$update pin_drafts set archived_at = now() where status = 'scheduled'$$), 'scheduled pins cannot be archived');

reset role;
\echo SPEC V1.8 TESTS PASSED
