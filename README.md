# Pin AI Studio

Multi-workspace Pinterest content studio: enter a pin idea, get five distinct pin drafts, edit, and save. Built in phases from the development brief.

## Integration status

| Integration | Status |
| --- | --- |
| Supabase auth + database | **Live Supabase project connected (26 Nov 2026), migrations 0001–0014 applied.** Without env vars the app runs in Demo mode (browser-only storage, clearly labelled). |
| Text AI | **Two adapters built.** Free: Cloudflare Workers AI (Llama 3.3 70B, JSON mode) using the same Cloudflare credentials as images. Best quality: Claude (`TEXT_AI_API_KEY`). Without either, drafts come from templates and are labelled **DEMO** everywhere. Neither tested from this build environment with live keys. |
| Image AI | **Three adapters built, not yet tested with live keys.** Recommended paid: fal.ai FLUX.3 Klein (~$0.011/pin; premium Nano Banana 2 or FLUX.3 via `IMAGE_AI_MODEL`). Free: Cloudflare Workers AI FLUX.2 klein 4B (~60/day). Alternative: OpenAI GPT Image. Without credentials, images are labelled DEMO placeholders. |
| Pin design | **Built and tested.** Title overlay, brand colours, font, handle and logo drawn on the server (resvg + sharp, bundled OFL fonts). |
| Trend finder | **Built.** Live Pinterest Trends when the app has Trends access; otherwise clearly labelled seasonal calendar suggestions. |
| Usage & budget | **Built.** Every AI call is logged with tokens and estimated cost; paid calls stop at `AI_MONTHLY_BUDGET_USD`. In Demo mode the ledger is in server memory. |
| Autopilot | **Built, not yet tested live.** Off by default. Turns queued ideas into pins and publishes them to Pinterest automatically within a daily limit and the AI budget. Needs Supabase, AI keys, Pinterest with publishing, and an hourly scheduler. |
| Production hardening | **Built.** Rate limits, security headers, structured logs, `/api/health`, data export and account deletion, CI. Rate limits are in-memory (one server instance); swap in Redis/Upstash for multi-instance hosting. |
| Spec v1.8 content tools | **Built and tested (unit + database tests).** 40-category taxonomy with automatic/manual/custom category, multi-language output, copy buttons, explainable quality score and proofreader, pin library search/filters/archive/duplicate/version history/rewrite one pin, CSV import/export, content calendar, destination link checker, UTM builder, board suggestion, activity log, all-accounts overview with pause-all. |
| Unlimited accounts | **Built and tested (unit + database tests).** Every user can add any number of Pinterest accounts on **All accounts** (each with its own brand, categories, boards, pins, Autopilot and Pinterest connection) and delete ones they no longer need. New users start with no accounts. Needs migrations `0013` and `0014`. |
| Competitor tracking | **Not available.** Pinterest v5 has no API for other accounts' analytics, so this is intentionally not built. |
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

The migrations enable row-level security on all tables and use composite foreign keys so a draft can't reference a category from another account. New users start with no accounts and add their own.

## One-step pins

In Studio, type a title and press **Make 5 complete pins**. The app writes 5 distinct pins (title, description, tags, alt text), saves them, and generates an image for each. They wait as drafts in *Review & publish* until you approve them. "Write text only" keeps the old edit-first flow.

## Pin design, links and trends

- **Pin design** (*Brand & categories*): style (subtle caption [default], magazine headline, minimal fade, elegant card, bold band, or none), font, brand and text colours, handle, logo. Every new image is cropped to 1000×1500 and gets the title drawn on it in that design, as a JPEG. Fonts (Poppins, DM Serif Display, Bebas Neue, SIL OFL) live in `public/fonts`.
- **Image prompts** (`src/lib/ai/image/prompt.ts`): every image prompt names the pin title, adds a premium editorial aesthetic, a different art direction per pin (flat lay, street style, cinematic, colour-block studio, seasonal set), lighting and composition cues, keeps the overlay area calm, and lists what to avoid (text, collages, distorted hands, stock-photo clichés).
- **Destination link**: Studio has a link box (defaults to the brand website); Autopilot has its own. Pinterest sends clicks there.
- **Trend finder**: chips under the Studio box. Live Pinterest Trends if fetched; otherwise seasonal calendar ideas, labelled as such.

## Spec v1.8 tools (this build)

- **Categories:** Macro starts with all 40 spec categories, Fashion with the first ten (migration `0008` adds any missing ones to existing accounts). In the Studio choose **Automatic** (the category is detected from the title and shown), **Choose** or **Custom** (optionally saved to that account only).
- **Language:** pick the output language per batch, or a default per account in Brand settings. English is used when nothing is chosen.
- **Brand profile:** display name, preferred image style, default call to action, language and market/region are used in every generation.
- **Quality check:** each pin gets an explainable 0-100 score (SEO, proofreading, accessibility, brand safety, destination). It checks text only and is not a promise of reach.
- **Pin library:** search, filter by status/category/date, archive, intentional duplicates, near-duplicate warnings across the library, image download, rewrite one pin without touching the other four, and version history with restore (last 30 versions, written by a database trigger).
- **Calendar:** month/week/day views of published, scheduled and drafted pins, plus seasonal ideas for next month (labelled as calendar ideas, not trend data).
- **Tools:** destination link checker (public addresses only, follows up to 5 redirects, compares page title with the pin), UTM builder that keeps existing parameters, CSV import with a validation preview and partial import, activity log.
- **All accounts:** health numbers and prioritised next steps for every workspace, and one button to pause Autopilot everywhere.

## Accounts & security (specs 12-13)

Sign-up, login, forgot/reset password, Welcome onboarding and Account settings run on Supabase Auth through server routes under `/api/auth`. Run migrations `0010_profiles.sql` and `0011_job_recovery.sql`. [SECURITY.md](SECURITY.md) lists what is built, the Supabase/Vercel settings to turn on, and what still needs infrastructure.

## Boards & categories (spec 11)

**Board categories:** every board gets a category detected from its name and description (your own categories first). On the Boards page you can pick a different category, or type a custom one, per board; picks are saved with board settings (`board_categories`, migration `0013`) and pins are matched to boards with the same category.

Run `supabase/migrations/0009_board_automation.sql` once on the live database. Until then, the Boards page still works for reading, but saving board settings or plans asks for the update.

- **Boards** come from the connected account's sync (`/api/pinterest/sync`). Until Pinterest is connected, labelled demo sample boards are used.
- **Per-pin picks:** the text AI reads each pin's keyword, title, description, tags and image description (alt text), and picks a content category and the most relevant board (`/api/boards/assign`). The server only accepts board ids from the account's own list. Picks below 45% confidence are not auto-assigned. Without a text AI key, keyword matching is used and labelled as such.
- **Modes:** Automatic (default; new Studio pins get a planned board in the background), Manual (one board for all), Keyword rules (your rules first, AI for the rest), and Custom (AI suggests, you choose each pin's board).
- **New boards:** suggested with a name, SEO description and keywords. A board is created on Pinterest only after you click Create and confirm. This needs the `boards:write` scope. The server re-reads the live board list and refuses duplicate names.
- **Bulk:** up to 50 keywords, each categorised and grouped by board. Rows are editable, the plan can be saved and downloaded as CSV, and pins later made from a planned keyword use its board.
- **Pre-schedule checks** on Review & publish confirm that a board is chosen, is valid, belongs to the connected account, is available, and is related to the pin. The server also refuses to schedule to a board that isn't in the account's synced boards, and it takes the board name from the sync.

## Automatic error log

Every unexpected error is recorded automatically so a bug can be found fast:

- **Server:** API routes and page renders report errors through `reportError` (`src/lib/server/errors.ts`) and `onRequestError` (`src/instrumentation.ts`). Each error gets an **error ID** (e.g. `ERR-MIA3KD-7Q3M`), and the 500 response shows it to the user (`errorId` field and `x-error-id` header).
- **Browser:** `ErrorReporter` (in the root layout) sends uncaught errors, unhandled promise rejections, page crashes (`error.tsx` / `global-error.tsx`) and failed API calls (5xx or network failure) to `POST /api/errors`.
- **Where to look:** each error is one JSON log line (`"event":"app_error"`) in Vercel logs with the route, status, message and `where` (first stack frame in the app's own code). With migration `0015_error_events.sql` run, errors are also saved to the `error_events` table and listed on **Account → Error log**, with a *Copy bug report* button. Secrets in messages and context are redacted.

Run `supabase/migrations/0015_error_events.sql` once in the Supabase SQL editor. Until then the error log still works through Vercel logs, and the Account page says the table is missing.

## Accounts (no limit)

Run `supabase/migrations/0013_unlimited_accounts.sql` and then `0014_no_starter_accounts.sql` once on the live database. 0013 adds a URL slug to each account, removes the one-per-kind limit, and adds `create_workspace` / `delete_workspace`. 0014 stops creating built-in accounts on sign-up: **new users start with no accounts** and add their own. The old Fashion / Macro starter accounts are deleted where they were never used (no pins, brand, Pinterest connection or Autopilot ideas); any that hold data are kept as ordinary accounts the user can rename or delete.

- **Add an account:** sidebar account menu → **+ Add account** (or **+ Add your first account**), or **All accounts** → *Add a Pinterest account*. Pick starter categories: *Fashion* (10) or *All topics* (all 40). Then connect that account's Pinterest.
- **Isolation:** every table is scoped by `workspace_id` and protected by row-level security on `owner_id`, so users only ever see their own accounts. Slugs are unique per user, so two users can both have `/w/recipes`.
- **Delete:** **All accounts** → *Delete* removes that account with its pins, boards, settings and Pinterest tokens.
- **Scale:** lookups go through the `(owner_id, slug)` unique index and per-workspace indexes. The dashboard loads accounts in parallel; for users with hundreds of accounts, a server-side summary endpoint would be the next step.

## Switch the image API

All images go through one provider layer (`src/lib/ai/image/index.ts`). To move to a different API when usage grows, set `IMAGE_AI_PROVIDER` (`fal`, `cloudflare`, `openai` or `demo`) plus its key in Vercel and redeploy; nothing else changes. To add a new API, write one file that implements `ImageProvider` (see `fal.ts`) and add one entry to `PROVIDERS`. Usage and cost are logged per provider on the Usage page.

## Autopilot (opt-in automatic publishing)

The brief requires approval before publishing. Autopilot is the owner's standing approval: it is **off by default**, turning it on requires typing `AUTO PUBLISH` (enforced by a database constraint), and pausing clears that consent.

- **Queue:** add titles or ideas (one per line) on the *Autopilot* tab.
- **Each hourly tick** (`/api/cron/autopilot`, `Authorization: Bearer $CRON_SECRET`): if no auto-approved pin is ready, the next idea becomes 5 pins with AI text and AI images; then one pin is published to the chosen board.
- **Limits:** 1–10 pins per day, spaced at least 90% of 24h ÷ limit apart; the monthly AI budget pauses it (the idea goes back in the queue); demo text or images are never published.
- **Safety:** every publish is audited (`autopilot_publish`); a pin that can't be published is parked as a draft with the reason; the same one-job-per-draft rule prevents duplicates.
- **Best time to post:** learns the 3-hour windows when your own pins got the most saves and clicks (top pins + pins published here, by post hour in your timezone). Pinterest only gives daily analytics, so this is per-pin, not hourly totals. Until 8 pins have stats it uses a labelled default (midday + evening).
- **Remake winners:** when the queue is empty, at most weekly, makes a fresh version of the best pin not remade in the last 60 days.
- **Trends:** optionally uses the fastest-growing Pinterest trend for your topic (or matching your focus keywords) not used in 30 days.
- **Built to become a full agent:** ideas come from an `IdeaSource` (`src/lib/autopilot/engine.ts`). Today it's the user's queue; a trends- or analytics-driven source can plug into the same interface (`autopilot_ideas.source` already allows `trends` and `agent`).
- **Scheduler:** Vercel Pro cron, or a free external scheduler such as cron-job.org calling `GET https://<domain>/api/cron/autopilot` hourly and `/api/cron/publish-due` every 5 minutes with the `Authorization` header. Vercel Hobby crons run only once a day.

## Phase 6: production readiness (this build)

- **Row-level security** on every table, tested on real Postgres (`supabase/tests/10_rls_test.sql`, 22 checks): workspace isolation, draft-status guards, Pinterest tokens invisible to users, one publish job per draft, single job claim, storage folders per workspace.
- **Token protection:** Pinterest tokens are AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEY`), stored in a table with no user policies, and only read by server code. AI keys never reach the browser. Logs redact any field named like a token, secret, key, password, cookie or authorization.
- **Rate limiting** (per signed-in user, else per IP, per minute): generate 20, images 10, insights 5, Pinterest sync/trends/refresh 10, workflow actions 30, account export/delete 5. Over the limit returns 429 with `Retry-After`.
- **Cost caps:** `AI_MONTHLY_BUDGET_USD` stops paid AI calls; the ledger is visible under *Usage & cost*.
- **Audit log:** every review, approval, schedule, publish attempt, export and account deletion is recorded in `audit_events`.
- **Security headers:** CSP (`frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, HSTS, strict referrer, permissions policy; `no-store` on every API response.
- **Monitoring:** `GET /api/health` returns which integrations are configured and whether the database answers (503 if not), with no secrets. Server errors go out as one-line JSON logs via `instrumentation.ts`, ready for any log drain (Vercel, Datadog, Axiom). Point an uptime monitor at `/api/health`.
- **Export & delete:** *Account & data* (top right) downloads a JSON export of all your accounts (never tokens) and deletes the account after typing `DELETE MY ACCOUNT`. Deletion removes images, drafts, connections and the auth user; pins already on Pinterest are left alone. In Demo mode the same page exports or clears browser data.
- **Automated tests:** unit tests (`npm test`), database tests (below) and GitHub Actions CI (`.github/workflows/ci.yml`) on every push and PR.

### Backup and recovery

- **Database:** Supabase takes daily backups on paid plans; turn on Point-in-Time Recovery (Project settings → Add-ons) to restore to any second. For an extra off-site copy, run `supabase db dump` on a schedule.
- **Images:** Supabase Storage is not included in database backups. Copy the `pin-images` bucket periodically (S3-compatible API or `supabase storage` CLI) if images must survive a project loss.
- **Schema:** everything is in `supabase/migrations/`, so a new project can be rebuilt by running them in order.
- **Per user:** the export endpoint gives each user a full JSON copy of their content.
- **Pinterest:** the source of truth for published pins stays on Pinterest; a sync re-imports boards and pins.

### Production checklist

1. Supabase project created, migrations applied, auth redirect URLs set, PITR on.
2. All env vars from `.env.example` set on the host; `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` are random 32-byte values, stored only there.
3. Pinterest app redirect URI set to `https://<your-domain>/api/pinterest/callback`, Standard access approved before publishing for real.
4. `AI_MONTHLY_BUDGET_USD` set to a figure you are comfortable with.
5. Scheduler calling `POST /api/cron/publish-due` with `Authorization: Bearer $CRON_SECRET` every 5 minutes (only needed for scheduled pins).
6. Uptime monitor on `/api/health`, log drain connected.
7. CI green.

## Checks

```bash
npm test          # unit tests
npm run typecheck
npm run lint
npm run build
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/test-db.sh   # migrations + RLS tests on a throwaway DB
```

## Layout

- `src/lib/ai/text/` – server-side text provider adapters (`demo`, `anthropic`), chosen by env
- `src/lib/drafts/` – angles, validation (zod), near-duplicate detection
- `src/lib/store/` – workspace-scoped data access (`SupabaseStore`, demo `LocalStore`)
- `src/app/api/generate` – draft generation route (auth-checked when Supabase is on)
- `src/app/api/status` – integration status for the UI (never returns secrets)
- `supabase/migrations/` – schema, RLS and signup bootstrap

## Still needs your accounts

The code for all six phases is in place. What remains needs accounts only you can create: a Supabase project, a Claude API key, an image provider choice, a Pinterest developer app, and a host to deploy to. See *Production checklist* above.
