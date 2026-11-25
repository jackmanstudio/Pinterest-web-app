# Pinterest AI Studio

Multi-workspace Pinterest content studio: enter a pin idea, get five distinct pin drafts, edit, and save. Built in phases from the development brief.

## Integration status

| Integration | Status |
| --- | --- |
| Supabase auth + database | **Built, not yet tested against a live project.** Without env vars the app runs in Demo mode (browser-only storage, clearly labelled). |
| Text AI (Claude) | **Adapter built, not yet tested with a live key.** Without `TEXT_AI_API_KEY` drafts come from templates and are labelled **DEMO** everywhere. |
| Image AI | **Pipeline built, no real provider yet.** Generates labelled DEMO placeholder images through the same route, storage and ledger a real provider will use. Adding a provider = one adapter in `src/lib/ai/image/`. |
| Usage & budget | **Built.** Every AI call is logged with tokens and estimated cost; paid calls stop at `AI_MONTHLY_BUDGET_USD`. In Demo mode the ledger is in server memory. |
| Pinterest API v5 | **OAuth, sync and approval-based publishing built, not yet tested against a live Pinterest app.** Needs your developer-app credentials. Publishing is off until `PINTEREST_ENABLE_PUBLISHING=true`, and every publish needs approval plus confirmation. |

## Phase 1 scope (this build)

- Email/password auth via Supabase (or Demo mode when unconfigured)
- Separate **Fashion** and **Macro** workspaces, each with its own brand settings, categories and drafts
- Category taxonomy (Fashion seeded with 5 categories; Macro starts empty)
- Generate 5 drafts per idea, one per angle: how-to, list, inspiration, problem→solution, seasonal
- Edit concept, title, description, tags, alt text and image prompt, with Pinterest length limits
- Save selected drafts; edit and delete saved drafts
- Integration status bar so nothing mocked is presented as live

## Run locally

```bash
npm install
cp .env.example .env.local   # optional; leave empty for Demo mode
npm run dev                  # http://localhost:3000
```

## Phase 2 (this build, without keys)

- Usage ledger (`ai_usage`): tokens, images, estimated cost and errors per call; users can read but never edit or delete rows
- Monthly budget cap enforced server-side before any paid call
- Image pipeline: `POST /api/images` → provider adapter (with capped retries) → private `pin-images` bucket under `<workspace_id>/` → signed URLs
- Per-draft image status (pending / ready / failed) with visible errors; Usage & cost page per workspace
- Text generation now records usage and shows estimated cost

## Phase 3 (this build)

- Per-workspace Pinterest OAuth (`/api/pinterest/connect` → Pinterest → `/api/pinterest/callback`), CSRF-protected with a signed, httpOnly, 10-minute state cookie bound to the signed-in user
- Tokens encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and stored in a table with no user-facing RLS policies; only the server (service role) reads them, and only after checking workspace ownership through the user's session
- Automatic refresh when the access token is within 24h of expiry; "Reconnect needed" when Pinterest rejects the refresh
- Shows connected account, Sandbox/Production, granted scopes and token expiry
- Read-only sync of boards and pins with bookmark pagination (page cap, no pruning on partial syncs), one sync at a time, sync status and errors (401, 403 `PINNER_DATA_ACCESS_DENIED`, 429 with retry-after)
- Disconnect removes stored tokens and synced copies only

## Phase 4 (this build)

- **Review & publish** page per workspace: Draft → In review → Approved → Scheduled → Published, with request-changes notes
- Browsers can only move Draft ↔ In review. Approve / schedule / publish / cancel run in a server route and are checked by a database trigger; editing approved content automatically withdraws the approval; scheduled and published pins are locked
- Publishing needs an approval **and** a second confirmation that names the account, board and Sandbox/Production
- Pre-publish checks: real (non-demo) PNG/JPEG image, field limits, valid link, board chosen, connection active, write scopes granted
- No duplicate pins: one live/successful job per draft (unique index), atomic job claim, a draft with a Pinterest pin ID is never published again, and after a timeout or 5xx the runner looks for the pin on the board before retrying
- Capped retries with backoff (uses Pinterest's `retry-after` on 429); failures return the pin to Approved with the reason
- Pinterest pin ID, time and board are stored and linked; every step goes into `audit_events` (shown as "Activity")
- Pinterest has no API for scheduling organic pins, so the app runs the schedule: call `GET /api/cron/publish-due` every few minutes with `Authorization: Bearer $CRON_SECRET` (e.g. Vercel Cron or any scheduler)
- In Demo mode, review and approval work in the browser; scheduling and publishing are disabled

To enable publishing: set `PINTEREST_ENABLE_PUBLISHING=true` and `CRON_SECRET`, run migration `0004`, then reconnect each workspace so Pinterest grants the write scopes.

## Phase 5 (this build)

- **Analytics** page per workspace: account overview (impressions, saves, pin clicks, outbound clicks, engagement rate), impressions-per-day chart with hover and table view, top pins by saves, and stats for pins published from the studio
- Every number comes from a stored snapshot of an official Pinterest v5 response (`/user_account/analytics`, `/user_account/analytics/top_pins`, `/pins/{id}/analytics`) and is shown with its endpoint, UTC date range, fetch time and Sandbox/Production. 7/30/90-day ranges (Pinterest's max is 90 days back)
- **Pinterest Trends** (`/trends/keywords/{region}/top/{type}`), shown only if Pinterest grants your app access
- **Growth insights agent** (Claude): reads only the stored snapshots, cites evidence, and any insight quoting a number not in the data is discarded automatically. It is disabled without a real AI key, and it's counted in usage/budget
- **Competitor tracking** is explicitly marked unavailable: there's no authorised data source
- Demo mode can preview the layout with clearly labelled SAMPLE data; it's never stored or sent to AI

## Connect Pinterest

Verified against the official Pinterest v5 docs and OpenAPI spec (Nov 2026).

1. Create an app at <https://developers.pinterest.com/apps/> and wait for Trial access.
2. Add the redirect URI exactly as in `PINTEREST_REDIRECT_URI` (e.g. `http://localhost:3000/api/pinterest/callback`, plus your production URL).
3. Put the App ID / secret in `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET`, generate `TOKEN_ENCRYPTION_KEY`, set `SUPABASE_SERVICE_ROLE_KEY`, and run migration `0003`.
4. Keep `PINTEREST_ENV=sandbox` while on Trial access (content you create is visible only to you). Switch to `production` after Pinterest grants Standard access, which requires a demo video of the OAuth flow.
5. Note: apps registered after 14 Sep 2026 may get `PINNER_DATA_ACCESS_DENIED` for non-business accounts until Pinterest authorises access.

## Connect Supabase

1. Create a Supabase project.
2. Run the files in `supabase/migrations/` in order in the SQL editor (or `supabase db push`).
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
4. In Supabase Auth → URL configuration, add `http://localhost:3000/auth/callback` (and your production URL) as a redirect URL.

The migration creates both workspaces for every new user, enables row-level security on all tables, and uses composite foreign keys so a draft can't reference a category from the other workspace.

## Checks

```bash
npm test          # unit tests (distinctness, demo provider, workspace isolation, provider selection)
npm run typecheck
npm run lint
npm run build
```

## Layout

- `src/lib/ai/text/` – server-side text provider adapters (`demo`, `anthropic`), chosen by env
- `src/lib/drafts/` – angles, validation (zod), near-duplicate detection
- `src/lib/store/` – workspace-scoped data access (`SupabaseStore`, demo `LocalStore`)
- `src/app/api/generate` – draft generation route (auth-checked when Supabase is on)
- `src/app/api/status` – integration status for the UI (never returns secrets)
- `supabase/migrations/` – schema, RLS and signup bootstrap

## Next phases

2. Real image generation, usage/cost tracking and budget caps
6. Production hardening
