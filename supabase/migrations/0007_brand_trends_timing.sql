-- Brand pin templates, smarter Autopilot (best posting times, trend and
-- winner-based ideas) and idea de-duplication.

-- Per-workspace pin design: style, font, colours, handle, logo (validated in the app).
alter table public.brand_settings add column pin_template jsonb not null default '{}'::jsonb;

alter table public.autopilot_settings
  add column timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  add column best_time boolean not null default true,
  add column remix_winners boolean not null default true,
  add column auto_trends boolean not null default false,
  add column trend_interest text check (trend_interest is null or trend_interest in
    ('womens_fashion', 'mens_fashion', 'beauty', 'home_decor', 'food_and_drinks', 'travel', 'art', 'design'));

-- What an automatic idea came from (a pin id for remixes, a keyword for trends), so it isn't repeated.
alter table public.autopilot_ideas add column ref text check (ref is null or char_length(ref) <= 200);
create index autopilot_ideas_ref_idx on public.autopilot_ideas (workspace_id, source, ref);
