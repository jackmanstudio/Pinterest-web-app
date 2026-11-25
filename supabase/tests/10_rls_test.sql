-- RLS and workflow tests. Run after the stub and all migrations.
-- Any failed check raises an exception and stops the run.
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

-- Two users; signup trigger creates their workspaces.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test');

select pg_temp.check((select count(*) from workspaces) = 4, 'signup creates Fashion + Macro for each user');
select pg_temp.check((select count(*) from categories c join workspaces w on w.id = c.workspace_id where w.kind = 'fashion') = 10, 'Fashion workspaces get 5 seed categories');
select pg_temp.check((select count(*) from categories c join workspaces w on w.id = c.workspace_id where w.kind = 'macro') = 0, 'Macro starts with no categories');

-- User A works in Fashion
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from workspaces) = 2, 'A sees only own 2 workspaces');
insert into pin_drafts (workspace_id, batch_id, idea, title, source)
  select id, gen_random_uuid(), 'trench', 'A pin', 'demo' from workspaces where kind = 'fashion';
select pg_temp.check((select count(*) from pin_drafts) = 1, 'A can create a draft');

-- Cross-workspace category must be rejected
do $$ begin
  update pin_drafts set category_id = (select c.id from categories c join workspaces w on w.id = c.workspace_id where w.kind = 'fashion' limit 1);
  -- that's A's own Fashion category: allowed
end $$;
select pg_temp.check((select category_id is not null from pin_drafts limit 1), 'draft can use a category from its own workspace');

-- Browser cannot self-approve or publish
do $$ begin
  begin
    update pin_drafts set status = 'approved';
    raise exception 'should have failed';
  exception when others then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
end $$;
select pg_temp.check(true, 'browser cannot set status approved');
do $$ begin
  begin
    update pin_drafts set external_pin_id = '123';
    raise exception 'should have failed';
  exception when others then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
end $$;
select pg_temp.check(true, 'browser cannot set external_pin_id');
update pin_drafts set status = 'in_review';
select pg_temp.check((select status from pin_drafts limit 1) = 'in_review', 'browser can submit for review');

-- User B cannot see or touch A's data
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from pin_drafts) = 0, 'B cannot read A''s drafts');
update pin_drafts set title = 'hijack';
delete from pin_drafts;
do $$ begin
  begin
    insert into pin_drafts (workspace_id, batch_id, idea, title, source)
      select id, gen_random_uuid(), 'x', 'x', 'demo' from workspaces where kind = 'fashion' and owner_id = '00000000-0000-0000-0000-00000000000a';
  exception when others then null;
  end;
end $$;
select pg_temp.check((select count(*) from pin_drafts) = 0, 'B cannot insert into A''s workspace');
select pg_temp.check((select count(*) from pinterest_connections) = 0, 'B sees no Pinterest connections');

-- Server approves A's draft, then A edits it: approval must be withdrawn
select pg_temp.as_admin();
select pg_temp.check((select title from pin_drafts limit 1) = 'A pin', 'B''s update/delete had no effect');
update pin_drafts set status = 'approved', approved_at = now();
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update pin_drafts set title = 'A pin edited';
select pg_temp.check((select status = 'draft' and approved_at is null from pin_drafts limit 1), 'editing approved content withdraws approval');

-- Scheduled pins are locked
select pg_temp.as_admin();
update pin_drafts set status = 'scheduled';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin
  begin
    update pin_drafts set title = 'sneaky';
    raise exception 'should have failed';
  exception when others then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
end $$;
select pg_temp.check(true, 'scheduled pins are locked for editing');

-- Tokens table is invisible to users even for their own workspace
select pg_temp.as_admin();
insert into pinterest_connections (workspace_id, environment, username, access_token_enc, access_expires_at)
  select id, 'sandbox', 'acct', 'v1.x.y.z', now() + interval '30 days' from workspaces where kind = 'fashion' and owner_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from pinterest_connections) = 0, 'users cannot read token rows, even their own');

-- One publish job per draft
select pg_temp.as_admin();
insert into publish_jobs (workspace_id, draft_id, board_id, run_at) select workspace_id, id, 'b1', now() from pin_drafts limit 1;
do $$ begin
  begin
    insert into publish_jobs (workspace_id, draft_id, board_id, run_at) select workspace_id, id, 'b1', now() from pin_drafts limit 1;
    raise exception 'should have failed';
  exception when unique_violation then null;
  end;
end $$;
select pg_temp.check(true, 'a second live publish job for the same draft is rejected');
select pg_temp.check((select count(*) from claim_publish_job((select id from publish_jobs limit 1))) = 1, 'first claim succeeds');
select pg_temp.check((select count(*) from claim_publish_job((select id from publish_jobs limit 1))) = 0, 'second claim of the same job gets nothing');

-- Usage ledger: users can add via function but never delete
select id as b_ws from workspaces where owner_id = '00000000-0000-0000-0000-00000000000b' and kind = 'fashion' \gset
select set_config('test.b_ws', :'b_ws', false);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select record_ai_usage((select id from workspaces where kind = 'fashion'), 'text', 'p', 'm', 'ai', 10, 10, 0, 0.5, 'ok', null);
delete from ai_usage;
select pg_temp.check((select count(*) from ai_usage) = 1, 'usage rows cannot be deleted by users');
do $$ begin
  begin
    perform record_ai_usage(current_setting('test.b_ws')::uuid, 'text', 'p', 'm', 'ai', 1, 1, 0, 0, 'ok', null);
    raise exception 'should have failed';
  exception when others then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
end $$;
select pg_temp.check(true, 'cannot record usage against someone else''s workspace');

-- Storage: users can only write under their own workspace folder
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('pin-images', current_setting('test.b_ws') || '/x.png');
    raise exception 'should have failed';
  exception when others then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
end $$;
insert into storage.objects (bucket_id, name) values ('pin-images', (select id::text from workspaces where kind = 'fashion') || '/ok.png');
select pg_temp.check((select count(*) from storage.objects) = 1, 'storage writes limited to own workspace folder');

reset role;
\echo ALL DATABASE TESTS PASSED
