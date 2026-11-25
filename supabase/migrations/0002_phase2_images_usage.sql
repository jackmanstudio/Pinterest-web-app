-- Pinterest AI Studio — Phase 2: image storage + AI usage/cost ledger

alter table public.pin_drafts
  add column image_path text,
  add column image_source content_source;

-- Usage ledger ---------------------------------------------------------------
-- Users can read their own rows. Rows are only added through record_ai_usage()
-- and can never be updated or deleted by users, so the budget cap can't be
-- bypassed by removing history.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  kind text not null check (kind in ('text', 'image')),
  provider text not null,
  model text,
  source content_source not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  images integer not null default 0,
  est_cost_usd numeric(12, 6) not null default 0,
  status text not null check (status in ('ok', 'error')),
  error text,
  created_at timestamptz not null default now()
);
create index ai_usage_owner_created_idx on public.ai_usage (owner_id, created_at desc);

alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select using (owner_id = auth.uid());

create or replace function public.record_ai_usage(
  p_workspace uuid, p_kind text, p_provider text, p_model text, p_source content_source,
  p_input_tokens integer, p_output_tokens integer, p_images integer, p_cost numeric,
  p_status text, p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_workspace is not null and not public.owns_workspace(p_workspace) then
    raise exception 'workspace not owned by caller';
  end if;
  if p_cost < 0 or p_input_tokens < 0 or p_output_tokens < 0 or p_images < 0 then
    raise exception 'usage values must be non-negative';
  end if;
  insert into ai_usage (owner_id, workspace_id, kind, provider, model, source, input_tokens, output_tokens, images, est_cost_usd, status, error)
  values (auth.uid(), p_workspace, p_kind, p_provider, p_model, p_source, p_input_tokens, p_output_tokens, p_images, p_cost, p_status, left(p_error, 500));
end $$;
revoke all on function public.record_ai_usage from public, anon;
grant execute on function public.record_ai_usage to authenticated;

-- Private image bucket, one folder per workspace ------------------------------
insert into storage.buckets (id, name, public) values ('pin-images', 'pin-images', false)
on conflict (id) do nothing;

create or replace function public.owns_workspace_folder(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(object_name))[1] and w.owner_id = auth.uid()
  );
$$;

create policy pin_images_select on storage.objects for select
  using (bucket_id = 'pin-images' and public.owns_workspace_folder(name));
create policy pin_images_insert on storage.objects for insert
  with check (bucket_id = 'pin-images' and public.owns_workspace_folder(name));
create policy pin_images_update on storage.objects for update
  using (bucket_id = 'pin-images' and public.owns_workspace_folder(name));
create policy pin_images_delete on storage.objects for delete
  using (bucket_id = 'pin-images' and public.owns_workspace_folder(name));
