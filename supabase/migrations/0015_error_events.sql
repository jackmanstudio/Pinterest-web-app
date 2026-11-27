-- Error log: every server error and every browser crash gets one row with an
-- error ID, the route and the message, so a bug can be found from the ID the
-- user sees. Each user can read and add only their own rows.

create table if not exists public.error_events (
  id text primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  source text not null check (source in ('server', 'client', 'api')),
  route text,
  method text,
  status int,
  message text not null,
  stack text,
  digest text,
  context jsonb not null default '{}'::jsonb
);

create index if not exists error_events_user_created on public.error_events (user_id, created_at desc);

alter table public.error_events enable row level security;

drop policy if exists error_events_select_own on public.error_events;
create policy error_events_select_own on public.error_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists error_events_insert_own on public.error_events;
create policy error_events_insert_own on public.error_events
  for insert to authenticated with check (user_id = auth.uid());
