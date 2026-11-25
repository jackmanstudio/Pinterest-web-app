-- Autopilot tests. Runs after 10_rls_test.sql (users A and B already exist).
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
select id as b_ws from workspaces where owner_id = '00000000-0000-0000-0000-00000000000b' and kind = 'fashion' \gset
select set_config('test.b_ws', :'b_ws', false);

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
create temp table a_ws as select id from workspaces where kind = 'fashion';
grant select on a_ws to authenticated;

insert into autopilot_settings (workspace_id) select id from a_ws;
select pg_temp.check((select not enabled from autopilot_settings), 'autopilot starts off');

select pg_temp.check(pg_temp.fails($$update autopilot_settings set enabled = true, board_id = 'b1'$$), 'cannot turn on without the consent phrase');
select pg_temp.check(pg_temp.fails($$update autopilot_settings set enabled = true, consent_text = 'AUTO PUBLISH'$$), 'cannot turn on without a board');
update autopilot_settings set enabled = true, consent_text = 'AUTO PUBLISH', board_id = 'b1';
select pg_temp.check((select enabled and enabled_at is not null and enabled_by = '00000000-0000-0000-0000-00000000000a' from autopilot_settings), 'turning on records who and when');
update autopilot_settings set enabled = false;
select pg_temp.check((select consent_text is null from autopilot_settings), 'pausing clears the consent, so resuming needs it again');
select pg_temp.check(pg_temp.fails($$update autopilot_settings set pins_per_day = 50$$), 'daily limit is capped at 10');

select pg_temp.check(pg_temp.fails(format($$insert into autopilot_settings (workspace_id) values (%L)$$, current_setting('test.b_ws'))), 'cannot create autopilot settings for another user''s workspace');

insert into autopilot_ideas (workspace_id, idea) select id, 'Autumn trench coat outfits' from a_ws;
select pg_temp.check(pg_temp.fails(format($$insert into autopilot_ideas (workspace_id, idea) values (%L, 'x idea')$$, current_setting('test.b_ws'))), 'cannot queue ideas in another user''s workspace');
select pg_temp.check(pg_temp.fails($$insert into autopilot_ideas (workspace_id, idea, status) select id, 'sneaky', 'done' from a_ws$$), 'users can only add queued ideas');
select pg_temp.check(pg_temp.fails($$select claim_autopilot_idea((select id from a_ws))$$), 'users cannot run the idea claimer');

select pg_temp.check(pg_temp.fails($$insert into pin_drafts (workspace_id, batch_id, idea, title, source, autopilot) select id, gen_random_uuid(), 'x idea', 't', 'demo', true from a_ws$$), 'browser cannot create autopilot drafts');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from autopilot_ideas) = 0, 'B cannot see A''s idea queue');
select pg_temp.check((select count(*) from autopilot_settings) = 0, 'B cannot see A''s autopilot settings');

select pg_temp.as_admin();
select pg_temp.check((select count(*) from claim_autopilot_idea((select id from a_ws))) = 1, 'server claims the next idea');
select pg_temp.check((select count(*) from claim_autopilot_idea((select id from a_ws))) = 0, 'an idea is claimed only once');
insert into pin_drafts (workspace_id, batch_id, idea, title, source, autopilot, status) select id, gen_random_uuid(), 'x idea', 't', 'ai', true, 'approved' from a_ws;
select pg_temp.check((select count(*) from pin_drafts where autopilot) = 1, 'server can create approved autopilot drafts');

-- Phase 8 columns
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update brand_settings set pin_template = '{"style":"minimal"}' where workspace_id = (select id from a_ws);
insert into brand_settings (workspace_id, pin_template) select id, '{"style":"minimal"}' from a_ws on conflict (workspace_id) do nothing;
select pg_temp.check((select pin_template->>'style' from brand_settings where workspace_id = (select id from a_ws)) = 'minimal', 'owner can save a pin design');
update autopilot_settings set timezone = 'Asia/Karachi', remix_winners = true, auto_trends = true, trend_interest = 'womens_fashion';
select pg_temp.check((select timezone = 'Asia/Karachi' and auto_trends from autopilot_settings), 'owner can set smart Autopilot options');
select pg_temp.check(pg_temp.fails($$update autopilot_settings set trend_interest = 'crypto'$$), 'trend topic must be a Pinterest interest');
select pg_temp.check(pg_temp.fails($$insert into autopilot_ideas (workspace_id, idea, source, ref) select id, 'trend idea', 'trends', 'x' from a_ws$$), 'users cannot fake trend ideas');
select pg_temp.as_admin();
insert into autopilot_ideas (workspace_id, idea, source, ref, status) select id, 'New version of a winner', 'agent', 'pin123', 'processing' from a_ws;
select pg_temp.check((select count(*) from autopilot_ideas where source = 'agent' and ref = 'pin123') = 1, 'server records where an automatic idea came from');

reset role;
\echo ALL DATABASE TESTS PASSED
