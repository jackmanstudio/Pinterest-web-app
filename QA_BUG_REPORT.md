# QA Bug Report: Pin AI Studio

Round 3, 2026-11-27. Code tested: `main` at 4762573 (PRs up to #26), with the fixes from this round applied on top.

## How this round was tested

| Area | How | Result |
|---|---|---|
| Automated suite | `vitest run`, `npm run typecheck`, `eslint`, `next build` | 314/314 tests pass (307 before, 7 new). Typecheck clean. Lint: 0 errors, 2 old warnings. Build OK. |
| Every page (23 routes) | Playwright on a local production build, demo mode, at 1280, 820 and 375 px wide | Every page loads, has no page errors and no 5xx. The only horizontal overflow was QA3-05, now fixed. |
| Buttons | Playwright sweep that clicks every safe, visible button on 14 app pages | No page errors and no 5xx. Disabled buttons were disabled for the right reason (no pins, demo mode). |
| API (38 endpoints) | GET and POST with an empty body, without a session | No 5xx and no stack traces. Bad input gets 400, unknown methods get 405, and cron routes get 401 without the secret. |
| Database security | Read through all 17 migrations | Every table has RLS on. Every security-definer function either checks `auth.uid()` ownership or is revoked from `anon` and `authenticated` (service role only). |
| SSRF | Code review of every server-side `fetch` | Every fetch of a URL the user gives goes through `safeFetch`, which blocks private and internal addresses. |
| XSS | Code review of `dangerouslySetInnerHTML` (pin overlay SVG) | Text is escaped, colours are hex-validated and the logo href is escaped. |
| Security headers | `curl -I` | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy and Permissions-Policy are all set. |
| Photo upload | Real files: good JPG and PNG, 200×200, corrupt JPG, GIF, empty file, same photo twice | Each problem file gets a clear message. The duplicate case was QA3-01, now fixed. |

## Bugs

| ID | Title | Area | Severity | Priority | Status |
|---|---|---|---|---|---|
| QA3-01 | The same photo can be added twice and becomes two pins | Tools › Make pins from your photos | Medium | P2 | Verified |
| QA3-02 | With the free text AI, every photo in a batch gets text about the first photo's topic | Tools › photo pins (`/api/photo-pins`) | High | P1 | Verified |
| QA3-03 | Clearing the schedule time shows "Invalid time value" | Review & publish › Schedule | Low | P3 | Verified |
| QA3-04 | 7 API routes show raw internal error text and don't record the error | `/api/usage`, `/api/account/export`, `/api/account/delete`, `/api/pinterest/{queue,disconnect,health,status}` | Medium (information leak) | P2 | Verified |
| QA3-05 | "Add" category button sticks out of the card on tablet | Brand & categories | Low | P3 | Verified |
| QA3-06 | Counter says "1 photos" | Tools › photo pins | Low | P4 | Verified |

### QA3-01: The same photo can be added twice
- **Steps:** Tools › Make pins from your photos › add `a.jpg` › add `a.jpg` again.
- **Expected:** The second copy is left out, with a message saying why.
- **Actual:** 2 photos were listed, and "Make 2 pins" made two pins from one photo.
- **Root cause:** `pick()` gave each file a random key and never compared contents.
- **Fix:** Each file is hashed (SHA-256) when picked. A photo whose hash is already in the list, or appears twice in the same pick, is skipped, and the user sees which photos were skipped.
- **Files:** `src/components/PhotoPins.tsx`, `src/lib/photos/validate.ts` (`duplicateNotice`)
- **Verified by:** `tests/qa-2026-11-27c.test.ts` (QA3-01). Also with Playwright: after adding the same file twice, the list shows "1 photo" and the message.

### QA3-02: Every photo got text about the first photo's topic
- **Steps:** With a text AI that can't see photos (the free Cloudflare model live), add `red-wool-coat.jpg` and `linen-summer-dress.png`, leave the shared topic empty, then make the pins.
- **Expected:** Each pin's text is about its own photo.
- **Actual:** Both pins were written about "red wool coat".
- **Root cause:** In the fallback branch, `/api/photo-pins` picked one idea for the whole batch (`b.topic || first photo's topic`) and spread those 5 drafts over all photos.
- **Fix:** Each photo now uses the shared topic when one is typed, otherwise its own topic (`photoTopic`). There is one AI request per distinct topic, and the requests run side by side. A photo with no topic at all now gets a clear 422 asking for one, instead of quietly borrowing another photo's topic.
- **Files:** `src/app/api/photo-pins/route.ts`, `src/lib/photos/validate.ts`
- **Verified by:** `tests/qa-2026-11-27c.test.ts` (QA3-02, 4 tests). Also with Playwright: the coat and dress photos give a coat pin and a dress pin.

### QA3-03: Empty schedule time gives "Invalid time value"
- **Root cause:** `new Date("").toISOString()` threw a RangeError in the browser before the server could check the time.
- **Fix:** The browser now runs the same `validateRunAt` check as the server before sending: empty, past (less than 5 minutes ahead) or more than 180 days ahead each get a plain message.
- **Files:** `src/components/PublishBoard.tsx`
- **Verified by:** `tests/qa-2026-11-27c.test.ts` (QA3-03). Scheduling is turned off in demo mode, so this was not run end to end in a browser.

### QA3-04: Raw internal errors were shown and not recorded
- **Root cause:** These routes returned `(err as Error).message` with status 500, so a Postgres or Supabase message reached the user. They also skipped `reportError`, so the failure never reached `error_events` or the Vercel logs.
- **Fix:** An `HttpError` still returns its own message and status. Any other error now goes through `errorResponse`, which logs it, stores it, and returns a friendly message with an Error ID and the `x-error-id` header.
- **Verified by:** `tests/qa-2026-11-27c.test.ts` (QA3-04): an internal table name does not appear in the response, and an Error ID does.

### QA3-05 / QA3-06
- **QA3-05:** At 640 to 900 px, the parent-category select grew to fit its longest option, which pushed "Add" 39 px past the card. The select now has a fixed width at `sm` and up, and the button doesn't shrink. Checked with the Playwright overflow scan at 820 px: no overflow.
- **QA3-06:** The counter now uses the singular for one photo.

## Blocked (not passed, not failed)

| ID | What | Why it's blocked | Needed from |
|---|---|---|---|
| BLK-01 | Pinterest OAuth, boards, publishing, token refresh, disconnect, rate limits | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` and `PINTEREST_REDIRECT_URI` are not set in Vercel yet (on purpose) | Owner: create the Pinterest app and add the keys. The mocked tests in `tests/pinterest.test.ts` and `tests/publishing-control.test.ts` pass, but they don't prove the real integration works. |
| BLK-02 | Live sign-up, login, reset password, and one user being unable to see another user's data, on production | The tester may not create accounts on the production site or type passwords | Owner: make two test accounts, or run the checks while signed in. RLS was checked by reading the code, and `tests/workspace-isolation.test.ts` and `tests/security.test.ts` pass. |
| BLK-03 | Scheduler publishing a real pin after the browser is closed | Publishing needs Pinterest (BLK-01). The pg_cron jobs were set up by migration 0017, but this session can't reach the database to read `worker_runs`. | Owner: after BLK-01, schedule one pin and check that it's published within 5 minutes. |
| BLK-04 | Load test: 50 AI pins at once, many users at once | The free Cloudflare quota is 10,000 neurons a day, and there's no staging copy to load-test | No production-scale claim is made. |

## Final status for this round

**BLOCKED.** No Critical or High bug is left open: QA3-02 (High) is fixed and verified. Pinterest publishing and live multi-user checks still can't be verified until BLK-01 and BLK-02 are done.
