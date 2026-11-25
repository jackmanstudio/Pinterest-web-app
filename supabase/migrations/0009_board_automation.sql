-- Spec 11: AI board & category automation.
-- Board settings per workspace and a planned board per pin. The planned board
-- is only a plan: publishing still sets pin_drafts.board_id on the server,
-- after approval, and checks that the board belongs to the connected account.

create table public.board_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto', 'manual', 'rules', 'custom')),
  manual_board_id text,
  manual_board_name text,
  -- [{ "keyword": "wedding", "board_id": "123", "board_name": "Wedding Ideas" }]
  rules jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 100),
  -- Bulk keyword plan: [{ "keyword": "...", "category": "...", "board_id": "...", "board_name": "..." }]
  keyword_plan jsonb not null default '[]'::jsonb check (jsonb_typeof(keyword_plan) = 'array' and jsonb_array_length(keyword_plan) <= 50),
  updated_at timestamptz not null default now(),
  constraint board_settings_manual check (mode <> 'manual' or manual_board_id is not null)
);
alter table public.board_settings enable row level security;
create policy board_settings_all on public.board_settings for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

create table public.draft_board_plans (
  draft_id uuid primary key references public.pin_drafts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  board_id text not null check (length(board_id) between 1 and 64),
  board_name text not null check (length(board_name) between 1 and 180),
  category text check (length(category) <= 80),
  reason text check (length(reason) <= 300),
  method text not null check (method in ('ai', 'keyword', 'rule', 'manual', 'custom', 'plan')),
  confidence smallint check (confidence between 0 and 100),
  updated_at timestamptz not null default now()
);
create index draft_board_plans_workspace_idx on public.draft_board_plans (workspace_id);
alter table public.draft_board_plans enable row level security;
create policy draft_board_plans_all on public.draft_board_plans for all
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

-- A plan's draft must be in the same workspace as the plan.
create or replace function public.guard_board_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pin_drafts d where d.id = new.draft_id and d.workspace_id = new.workspace_id) then
    raise exception 'draft and board plan must be in the same workspace';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger draft_board_plans_guard before insert or update on public.draft_board_plans
  for each row execute function public.guard_board_plan();

-- Boards created from the app (after the user approved the suggestion).
alter table public.pinterest_boards add column if not exists created_in_app boolean not null default false;
