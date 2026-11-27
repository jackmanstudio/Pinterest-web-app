import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ hasAdminSupabase: () => true, getAdminSupabase: () => ({ rpc }) }));

const req = (auth?: string) => new Request("http://localhost/api/cron/publish-due", { headers: auth ? { authorization: auth } : {} });

describe("cron authorization", () => {
  it("accepts the CRON_SECRET env var without asking the database", async () => {
    vi.stubEnv("CRON_SECRET", "env-secret-123");
    const { cronAuthorized } = await import("@/lib/server/cron");
    rpc.mockReset();
    expect(await cronAuthorized(req("Bearer env-secret-123"))).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("accepts the Supabase scheduler's own secret, checked by the database", async () => {
    const { cronAuthorized } = await import("@/lib/server/cron");
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    expect(await cronAuthorized(req("Bearer " + "a".repeat(64)))).toBe(true);
    expect(rpc).toHaveBeenCalledWith("verify_cron_secret", { p_token: "a".repeat(64) });
  });

  it("refuses missing, wrong or unverifiable tokens", async () => {
    const { cronAuthorized } = await import("@/lib/server/cron");
    rpc.mockReset().mockResolvedValue({ data: false, error: null });
    expect(await cronAuthorized(req())).toBe(false);
    expect(await cronAuthorized(req("Basic abc"))).toBe(false);
    expect(await cronAuthorized(req("Bearer wrong"))).toBe(false);
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect(await cronAuthorized(req("Bearer " + "b".repeat(64)))).toBe(false);
  });
});
