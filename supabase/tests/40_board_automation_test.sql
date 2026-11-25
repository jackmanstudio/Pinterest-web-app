-- Spec 11: board automation settings and per-pin board plans.
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd@test'), ('00000000-0000-0000-0000-0000000000d2', 'e@test');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
create temp table d_fa as select id from workspaces where kind = 'fashion' and owner_id = '00000000-0000-0000-0000-0000000000d1';
create temp table d_ma as select id from workspaces where kind = 'macro' and owner_id = '00000000-0000-0000-0000-0000000000d1';
insert into board_settings (workspace_id) select id from d_fa;
select pg_temp.check((select mode = 'auto' from board_settings), 'board mode defaults to Automatic');
select pg_temp.check(pg_temp.fails($$update board_settings set mode = 'manual'$$), 'manual mode needs a board');
update board_settings set mode = 'manual', manual_board_id = 'b1', manual_board_name = 'Outfits';
select pg_temp.check((select mode = 'manual' from board_settings), 'owner can choose one board for all pins');
select pg_temp.check(pg_temp.fails($$update board_settings set mode = 'random'$$), 'unknown modes are rejected');
update board_settings set mode = 'rules', rules = '[{"keyword":"wedding","board_id":"b2","board_name":"Wedding"}]';
select pg_temp.check((select jsonb_array_length(rules) = 1 from board_settings), 'owner can save keyword rules');

insert into pin_drafts (workspace_id, batch_id, idea, title, source) select id, gen_random_uuid(), 'trench', 'Trench coat looks', 'manual' from d_fa;
insert into pin_drafts (workspace_id, batch_id, idea, title, source) select id, gen_random_uuid(), 'sofa', 'Sofa ideas', 'manual' from d_ma;
insert into draft_board_plans (draft_id, workspace_id, board_id, board_name, category, method, confidence)
  select d.id, d.workspace_id, 'b1', 'Outfits', 'Fashion', 'ai', 82 from pin_drafts d where d.workspace_id = (select id from d_fa);
select pg_temp.check((select count(*) from draft_board_plans) = 1, 'owner can plan a board for a pin');
select pg_temp.check(pg_temp.fails($$insert into draft_board_plans (draft_id, workspace_id, board_id, board_name, method)
  select d.id, (select id from d_fa), 'b1', 'Outfits', 'ai' from pin_drafts d where d.workspace_id = (select id from d_ma)$$), 'a plan cannot point at a pin in the other workspace');
select pg_temp.check(pg_temp.fails($$update draft_board_plans set confidence = 140$$), 'confidence stays within 0-100');
select pg_temp.check(pg_temp.fails($$update pin_drafts set board_id = 'b1'$$), 'the publish board is still set only by the server');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select pg_temp.check((select count(*) from board_settings) = 0, 'other users cannot see board settings');
select pg_temp.check((select count(*) from draft_board_plans) = 0, 'other users cannot see board plans');
select pg_temp.check(pg_temp.fails($$insert into board_settings (workspace_id) select id from d_ma$$), 'other users cannot write board settings');
update draft_board_plans set board_id = 'x';
select pg_temp.as_admin();
select pg_temp.check((select board_id = 'b1' from draft_board_plans), 'other users cannot change board plans');

select pg_temp.as_admin();
delete from pin_drafts where workspace_id = (select id from d_fa);
select pg_temp.check((select count(*) from draft_board_plans) = 0, 'deleting a pin removes its board plan');

reset role;
\echo BOARD AUTOMATION TESTS PASSED
