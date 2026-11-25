# Pinterest AI Studio

Multi-workspace Pinterest content studio: enter a pin idea, get five distinct pin drafts, edit, and save. Built in phases from the development brief.

## Integration status

| Integration | Status |
| --- | --- |
| Supabase auth + database | **Built, not yet tested against a live project.** Without env vars the app runs in Demo mode (browser-only storage, clearly labelled). |
| Text AI (Claude) | **Adapter built, not yet tested with a live key.** Without `TEXT_AI_API_KEY` drafts come from templates and are labelled **DEMO** everywhere. |
| Image AI | Not connected (Phase 2). Image status shows "No image yet". |
| Pinterest API v5 | Not connected (Phase 3). Nothing is published, scheduled or synced. |

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

## Connect Supabase

1. Create a Supabase project.
2. Run `supabase/migrations/0001_phase1_core.sql` in the SQL editor (or `supabase db push`).
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
3. Pinterest OAuth (verify current v5 docs, scopes, access tier and rate limits first)
4. Approval-based publishing with idempotency
5. Analytics and agents (verified data only)
6. Production hardening
