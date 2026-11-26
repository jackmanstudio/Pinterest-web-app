-- No built-in accounts.
-- New users start with no accounts and add their own Pinterest accounts.
-- The old Fashion / Macro starter accounts are removed where nobody used them
-- (no pins, no brand, no Pinterest connection, no Autopilot ideas). Any starter
-- account that holds the user's data is kept: it is just one of their accounts
-- now, and they can rename or delete it.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.bootstrap_user_workspaces();

delete from public.workspaces w
 where w.slug in ('fashion', 'macro')
   and not exists (select 1 from public.pin_drafts d where d.workspace_id = w.id)
   and not exists (select 1 from public.pinterest_connections c where c.workspace_id = w.id)
   and not exists (select 1 from public.autopilot_ideas i where i.workspace_id = w.id)
   and not exists (
     select 1 from public.brand_settings b
      where b.workspace_id = w.id and (btrim(b.brand_name) <> '' or btrim(b.website_url) <> '')
   );

-- Any account can be deleted, including the last one.
create or replace function public.delete_workspace(p_workspace uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  delete from workspaces where id = p_workspace and owner_id = uid;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.delete_workspace(uuid) from public, anon;
grant execute on function public.delete_workspace(uuid) to authenticated;
