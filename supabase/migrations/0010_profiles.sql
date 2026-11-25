-- Spec 12: user profile (name, terms acceptance, notification preferences).
-- Passwords, sessions, email verification and reset tokens are handled by
-- Supabase Auth (bcrypt-hashed passwords, single-use expiring tokens); this
-- table never stores credentials. Pinterest tokens stay in pinterest_connections.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 100),
  terms_accepted_at timestamptz,
  notify_publish_failures boolean not null default true,
  notify_weekly_summary boolean not null default false,
  notify_product_updates boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select using (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- No insert/delete policies: rows are created by the trigger below and removed with the user.

create or replace function public.guard_profile() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' and (new.terms_accepted_at is distinct from old.terms_accepted_at or new.created_at is distinct from old.created_at) then
    raise exception 'terms acceptance and creation time cannot be changed';
  end if;
  new.full_name := btrim(new.full_name);
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile();

create or replace function public.create_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, full_name, terms_accepted_at)
  values (
    new.id,
    left(btrim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), 100),
    case when (meta ->> 'terms_accepted') = 'true' then now() end
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created_profile after insert on auth.users
  for each row execute function public.create_profile();

-- Existing users get a profile too.
insert into public.profiles (id, full_name)
select u.id, left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 100) from auth.users u
on conflict (id) do nothing;
