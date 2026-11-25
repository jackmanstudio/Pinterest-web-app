# Security, encryption and scalability (specs 12 & 13)

This is an honest status list. **Built** means it's in the code and covered by tests. **Needs your setup** means it depends on a setting in Supabase or Vercel, or on a service the project doesn't have yet. Nothing here has had an external penetration test, so don't call the app "production-ready" until the checklist at the end is done.

## 1. Architecture

| Area | Status |
|---|---|
| Frontend (Next.js pages and components), backend (route handlers under `src/app/api`), database (Supabase Postgres), background work (cron routes), integrations (`src/lib/pinterest`, `src/lib/ai`) are separate modules | Built |
| Business logic in `src/lib/**` (pure, unit-tested); components only render | Built |
| Stateless app servers (scale horizontally on Vercel). Exception: the in-memory rate limiter, see section 7 | Built, with that exception |
| Slow work runs asynchronously: publishing is a queue (`publish_jobs`) drained by `/api/cron/publish-due`; images are generated per pin with a small worker pool | Built |
| API versioning | Not added. The API is internal to this app (same deploy as the UI). Add `/api/v1` if third parties ever call it. |

## 2. Database and tenant isolation

| Control | Status |
|---|---|
| Every user-owned row carries `workspace_id` (→ `workspaces.owner_id`) or `id = auth.uid()` | Built |
| Row-level security on **every** table. A unit test fails the build if a new table forgets it (`tests/security.test.ts`) | Built |
| RLS behaviour tests (user A can't read or write user B's data) run in CI on real Postgres: `supabase/tests/*.sql` | Built |
| Server never trusts a client-sent user id: it reads the user from the session (`supabase.auth.getUser()`) and checks workspace ownership before using the service role | Built |
| Foreign keys and checks: cross-workspace references are blocked by composite keys and triggers | Built |
| Parameterised queries only (Supabase client and PL/pgSQL); no SQL string building | Built |
| Indexes on hot paths (workspace + created, due jobs, board plans) | Built |
| Migrations are plain SQL files, applied in order and tested in CI | Built. **You run each new one** in the Supabase SQL editor: 0009, 0010, 0011 |
| Database credentials are never sent to the browser (only the public anon key, which RLS limits) | Built |

## 3. Encryption

| Control | Status |
|---|---|
| HTTPS everywhere, HTTP redirected to HTTPS | Done by Vercel. HSTS header (2 years, preload) is set by the app |
| Pinterest access and refresh tokens are encrypted with **AES-256-GCM** before storage, with a random IV per value and an auth tag | Built |
| Key kept outside the database (`TOKEN_ENCRYPTION_KEY` in Vercel env) | Built |
| **Key rotation**: v2 format carries a key id; old keys are read via `TOKEN_ENCRYPTION_KEY_PREVIOUS`; tokens re-encrypt on use or all at once with `POST /api/cron/rotate-token-key` | Built (new) |
| Tokens never logged (log scrubber redacts token/secret/key/password/cookie fields), never returned to the browser, never in exports | Built |
| Tokens decrypted only in server routes that publish or sync | Built |
| Database and file storage encrypted at rest | Supabase does this (AES-256) on all plans |
| **Managed KMS / envelope encryption** | **Needs infrastructure.** Plan: keep AES-256-GCM per token, but wrap a per-tenant data key with a KMS key (AWS KMS or GCP KMS) and store only the wrapped key. The `v2.<keyId>` format leaves room for a `v3.<kmsKeyId>` without a data migration. Supabase Vault is a lighter option if you stay on Supabase. |

## 4. Authentication (spec 12)

| Control | Status |
|---|---|
| Passwords hashed by Supabase Auth (**bcrypt**); this app never stores or logs them | Built (Supabase). Argon2id isn't available in Supabase Auth; bcrypt is an accepted strong algorithm |
| Strong password rules (10+ chars, mixed case, number, symbol, not common, not your name or email), checked in the browser **and** on the server | Built |
| Sign-up, login, forgot, reset, password change, profile and logout all go through server routes with zod validation | Built |
| Rate limits: login 10 per 10 min per IP **and** 5 per 15 min per email; sign-up 5 per hour per IP; reset emails 3 per 15 min | Built (per server instance, see section 7). Supabase Auth adds its own limits |
| No account enumeration: same answers for known and unknown emails on sign-up, login and reset | Built |
| Reset links: single-use and expiring (Supabase, 1 hour by default). Our extra "skip current password" marker is HMAC-signed, tied to the user and lasts 15 minutes | Built |
| Password change signs out your other devices | Built |
| Deleting an account needs the typed confirmation **and** your password | Built |
| Safe redirects after sign-in (`?next=` must be a same-site path) | Built |
| Every private page and API requires a session (`src/proxy.ts`); public pages are listed explicitly | Built |
| "Remember me" off = session cookies end when the browser closes | Built |
| Google sign-in uses Supabase's PKCE flow | Built; **needs** the Google provider enabled in Supabase and `NEXT_PUBLIC_AUTH_GOOGLE=true` |
| Session cookies are **not HttpOnly** | **Known gap.** The browser talks to Supabase directly (with RLS), so the Supabase SSR library must read the session cookie. The XSS risk is reduced by the CSP below. Full fix: move all data access behind server routes, then turn on HttpOnly cookies. That is a larger refactor, planned separately. |

**Supabase Auth settings to turn on (Dashboard → Authentication):**
1. Email confirmations: **on**. Secure email change: **on**. Secure password change: **on**.
2. Password: minimum length **10**, require letters + digits + symbols; leaked-password protection (Pro plan).
3. URL configuration: Site URL = your Vercel URL; Redirect URLs = `https://YOUR-SITE/auth/callback`.
4. Email OTP / link expiry: **3600 s** or less.
5. Custom SMTP (Resend, Postmark, SES): the built-in sender is limited to a few emails per hour and isn't meant for production.
6. Optional: Google provider (client id and secret from Google Cloud), then set `NEXT_PUBLIC_AUTH_GOOGLE=true` in Vercel.

## 5. Web security headers and CSRF

| Control | Status |
|---|---|
| CSP: `default-src 'self'`, scripts and styles only from this site, the browser may call only this site and Supabase, no frames, no plugins, `frame-ancestors 'none'`, `upgrade-insecure-requests` | Built (tightened) |
| `script-src` still allows `'unsafe-inline'` | Needed for Next's inline bootstrap. Moving to nonces would make every page dynamic; revisit if needed |
| HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP | Built |
| CSRF: SameSite=Lax cookies, JSON-only APIs, and auth routes reject cross-site `Origin` | Built |
| Pinterest OAuth: random `state` in a signed, HttpOnly, short-lived cookie, bound to the user and workspace; client secret stays on the server | Built. Pinterest's OAuth is a confidential-client code flow; PKCE is used where the provider supports it (Supabase/Google) |
| SSRF guard on the link checker (blocks private and loopback addresses, limits redirects) | Built |

## 6. Background jobs

| Control | Status |
|---|---|
| Idempotency: one live or successful job per pin (unique index); before any retry after an uncertain failure, Pinterest is checked for the pin so it's never posted twice | Built |
| Retries with exponential backoff (honours Pinterest `Retry-After`), capped by `max_attempts` | Built |
| Dead-letter: jobs out of attempts end as `failed`, the pin returns to Approved with the reason shown | Built |
| **Crash recovery**: jobs stuck in `running` (worker timed out) are re-queued as "uncertain" or failed for good (`recover_stale_publish_jobs`, run by the cron) | Built (new, migration 0011) |
| Atomic claim (`claim_publish_job`), callable only by the server | Built |
| Scheduler | **Needs your setup**: a Vercel Cron (or any scheduler) calling `/api/cron/publish-due` every 5 minutes with `Authorization: Bearer $CRON_SECRET`. The Vercel Hobby plan only allows daily crons. |

## 7. Known limits and plans

- **Rate limiting across instances**: the limiter is in memory, per server instance. On Vercel, several instances can run at once, so the real ceiling is higher. Plan: swap in Upstash Redis (same `check()` interface) once you have an Upstash account. Supabase Auth's own limits still apply to login and sign-up.
- **Email notifications**: preferences are saved, but no email provider is connected yet, so no emails are sent. The app says so on the settings page.
- **Monitoring and alerts**: logs are structured JSON (ready for a log drain). Error alerting (Sentry or similar) needs an account.
- **Backups**: Supabase daily backups (Pro plan: point-in-time recovery). Test a restore once.

## 8. CI

Every push runs: production dependency audit (`npm audit --omit=dev --audit-level=high`), a scan for committed secrets, lint, type check, unit tests (including the RLS and secret guard rails above), build, and all migrations with the database tests on Postgres 16. Dependabot opens weekly update PRs.

## Before calling it production-ready

1. Run migrations 0009, 0010 and 0011 on the live database.
2. Apply the Supabase Auth settings in section 4 and set up custom SMTP.
3. Set `TOKEN_ENCRYPTION_KEY`, `AUTH_COOKIE_SECRET`, `CRON_SECRET` and `NEXT_PUBLIC_SITE_URL` in Vercel (as Production env vars, never in code or chat).
4. Set up the publish cron and an error-alerting service.
5. Move rate limits to Redis if you run more than one instance.
6. Get an independent security review or penetration test.
