import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ensureAccessTokenLocked, type TokenStore } from "@/lib/pinterest/sync";
import { workerState } from "@/lib/server/workerRuns";
import { cleanTimeZone, formatInZone } from "@/lib/workflow/timezone";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const expiring: TokenStore = { access_token: "old", refresh_token: "r1", access_expires_at: new Date(NOW + 3600_000).toISOString(), refresh_expires_at: null };
const fresh: TokenStore = { access_token: "new", refresh_token: "r2", access_expires_at: new Date(NOW + 30 * 86_400_000).toISOString(), refresh_expires_at: null };
const tokens = { access_token: "new", refresh_token: "r2", expires_in: 2592000, token_type: "bearer", scope: "" };

function lock(got: boolean | null, reloads: (TokenStore | null)[] = []) {
  return {
    tryLock: vi.fn(async () => got),
    unlock: vi.fn(async () => {}),
    reload: vi.fn(async () => (reloads.length ? reloads.shift()! : null)),
    onRefreshed: vi.fn(async () => {}),
  };
}

describe("token refresh lock", () => {
  it("does nothing when the token is still fresh", async () => {
    const l = lock(true);
    const api = { refresh: vi.fn() };
    expect(await ensureAccessTokenLocked(api as never, fresh, l, { now: NOW })).toBe("new");
    expect(l.tryLock).not.toHaveBeenCalled();
  });

  it("refreshes once under the lock and releases it", async () => {
    const l = lock(true, [expiring]);
    const api = { refresh: vi.fn(async () => tokens) };
    expect(await ensureAccessTokenLocked(api as never, expiring, l, { now: NOW })).toBe("new");
    expect(api.refresh).toHaveBeenCalledWith("r1");
    expect(l.onRefreshed).toHaveBeenCalledWith(tokens, "r1");
    expect(l.unlock).toHaveBeenCalled();
  });

  it("uses a token another request just refreshed instead of refreshing again", async () => {
    const l = lock(true, [fresh]);
    const api = { refresh: vi.fn() };
    expect(await ensureAccessTokenLocked(api as never, expiring, l, { now: NOW })).toBe("new");
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it("waits for the other request when the lock is taken", async () => {
    const l = lock(false, [expiring, fresh]);
    const api = { refresh: vi.fn() };
    expect(await ensureAccessTokenLocked(api as never, expiring, l, { now: NOW, waitMs: 1 })).toBe("new");
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it("falls back to a plain refresh on a database without the lock", async () => {
    const l = lock(null);
    const api = { refresh: vi.fn(async () => tokens) };
    expect(await ensureAccessTokenLocked(api as never, expiring, l, { now: NOW })).toBe("new");
    expect(l.unlock).not.toHaveBeenCalled();
  });

  it("releases the lock even when Pinterest refuses the refresh", async () => {
    const l = lock(true, [expiring]);
    const api = { refresh: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(ensureAccessTokenLocked(api as never, expiring, l, { now: NOW })).rejects.toThrow("boom");
    expect(l.unlock).toHaveBeenCalled();
  });
});

describe("schedule timezone", () => {
  it("accepts real IANA names and rejects junk", () => {
    expect(cleanTimeZone("Asia/Karachi")).toBe("Asia/Karachi");
    expect(cleanTimeZone("Mars/Base")).toBeNull();
    expect(cleanTimeZone(undefined)).toBeNull();
  });

  it("shows the UTC time in the user's zone across a DST change", () => {
    // 2026-03-08 is the US spring-forward day: 14:00 UTC is 9 AM before, 10 AM after.
    expect(formatInZone("2026-03-07T14:00:00Z", "America/New_York")).toMatch(/9:00\s?AM/);
    expect(formatInZone("2026-03-09T14:00:00Z", "America/New_York")).toMatch(/10:00\s?AM/);
  });
});

describe("worker heartbeat", () => {
  const run = (minsAgo: number, ok = true) => ({ name: "publish-due", last_run_at: new Date(NOW - minsAgo * 60_000).toISOString(), last_ok: ok, last_result: {} });
  it("reports on time, late, error and never", () => {
    expect(workerState(run(4), 5, NOW)).toBe("ok");
    expect(workerState(run(30), 5, NOW)).toBe("late");
    expect(workerState(run(1, false), 5, NOW)).toBe("error");
    expect(workerState(undefined, 5, NOW)).toBe("never");
  });
});

describe("migration 0016", () => {
  const sql = readFileSync("supabase/migrations/0016_publishing_control.sql", "utf8");
  it("keeps the lock and worker table away from browsers", () => {
    expect(sql).toMatch(/revoke all on function public\.claim_token_refresh from public, anon, authenticated/);
    expect(sql).toMatch(/alter table public\.worker_runs enable row level security/);
    expect(sql).not.toMatch(/create policy .* on public\.worker_runs/);
  });
});
