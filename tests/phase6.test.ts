import { describe, expect, it, vi } from "vitest";
import { RateLimiter, callerKey, rateLimited, LIMITS } from "@/lib/server/rateLimit";
import { log } from "@/lib/server/log";
import nextConfig from "../next.config";

describe("rate limiter", () => {
  it("allows up to the limit, then blocks with a retry time, then resets", () => {
    const r = new RateLimiter();
    for (let i = 0; i < 3; i++) expect(r.check("k", 3, 60_000, 1000).ok).toBe(true);
    const blocked = r.check("k", 3, 60_000, 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(r.check("other", 3, 60_000, 1000).ok).toBe(true);
    expect(r.check("k", 3, 60_000, 61_001).ok).toBe(true);
  });

  it("keys callers by session cookie, else by IP", () => {
    const a = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(callerKey(a)).toBe("ip:1.2.3.4");
    const b = new Request("http://x", { headers: { cookie: "sb-abc-auth-token=base64-eyJhbGciOiJIUzI1" } });
    expect(callerKey(b)).toMatch(/^s:/);
  });

  it("returns a 429 with Retry-After once over the limit", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9" } });
    for (let i = 0; i < LIMITS.account.limit; i++) expect(rateLimited(req, "account")).toBeNull();
    const res = rateLimited(req, "account");
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("structured logging", () => {
  it("redacts secret-looking fields at any depth", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "test", { access_token: "abc", nested: { client_secret: "s", ok: 1 }, apiKey: "k" });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.access_token).toBe("[redacted]");
    expect(line.nested.client_secret).toBe("[redacted]");
    expect(line.nested.ok).toBe(1);
    expect(line.apiKey).toBe("[redacted]");
    expect(JSON.stringify(line)).not.toContain("abc");
    spy.mockRestore();
  });
});

describe("security headers", () => {
  it("sets clickjacking, sniffing and no-store API headers", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    const get = (k: string) => all.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value;
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const api = rules.find((r) => r.source.startsWith("/api"))!.headers;
    expect(api.find((h) => h.key === "Cache-Control")?.value).toBe("no-store");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
