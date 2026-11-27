-- Built-in scheduler: Supabase runs the publish and autopilot jobs itself
-- (pg_cron + pg_net), so no outside cron service is needed.
-- The secret those calls send is generated here and kept in Supabase Vault;
-- nobody has to copy it anywhere. The app checks it with verify_cron_secret().
--
-- After running this file, start the jobs once with:
--   select public.setup_cron_jobs('https://your-app.vercel.app');
-- Safe to run more than once. On a plain Postgres without these Supabase
-- extensions it only creates the functions.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if to_regclass('vault.secrets') is not null then
    if not exists (select 1 from vault.secrets where name = 'cron_secret') then
      -- Two random UUIDs: 64 hex characters, generated inside the database.
      perform vault.create_secret(
        replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
        'cron_secret',
        'Bearer token the scheduler sends to /api/cron/*'
      );
    end if;
  end if;
end $$;

-- True when the token is the scheduler's secret. Server (service role) only.
create or replace function public.verify_cron_secret(p_token text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ok boolean := false;
begin
  if p_token is null or length(p_token) < 32 or to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;
  execute 'select exists (select 1 from vault.decrypted_secrets where name = $1 and decrypted_secret = $2)'
    into ok using 'cron_secret', p_token;
  return ok;
end $$;
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- (Re)creates the two jobs for the app at p_base_url. Run from the SQL editor.
create or replace function public.setup_cron_jobs(p_base_url text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  base text := rtrim(p_base_url, '/');
  cmd text;
begin
  if base !~ '^https://[a-z0-9.-]+$' then
    raise exception 'Give the app address like https://your-app.vercel.app';
  end if;
  if to_regnamespace('cron') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'This needs the pg_cron, pg_net and Vault extensions (Supabase).';
  end if;
  execute 'select cron.unschedule(jobid) from cron.job where jobname in (''pin-publish-due'', ''pin-autopilot'')';
  cmd := $c$select net.http_post(url := %L, body := '{}'::jsonb, timeout_milliseconds := 55000,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')))$c$;
  execute 'select cron.schedule($1, $2, $3)' using 'pin-publish-due', '*/5 * * * *', format(cmd, base || '/api/cron/publish-due');
  execute 'select cron.schedule($1, $2, $3)' using 'pin-autopilot', '7 * * * *', format(cmd, base || '/api/cron/autopilot');
  return 'Scheduled: publish every 5 minutes, autopilot every hour, for ' || base;
end $$;
revoke all on function public.setup_cron_jobs(text) from public, anon, authenticated;
