import { describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";
import { PinterestApi, PinterestApiError, pinImageUrl } from "@/lib/pinterest/api";
import { buildAuthorizeUrl, checkPinterestConfig, getPinterestConfig } from "@/lib/pinterest/config";
import { tokenExpiries } from "@/lib/pinterest/connections";
import { createState, verifyState } from "@/lib/pinterest/state";
import { describePinterestError, ensureAccessToken, fetchBoardsAndPins, needsRefresh, ReconnectRequired } from "@/lib/pinterest/sync";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = {
  PINTEREST_CLIENT_ID: "cid", PINTEREST_CLIENT_SECRET: "secret", PINTEREST_REDIRECT_URI: "http://localhost:3000/api/pinterest/callback",
  TOKEN_ENCRYPTION_KEY: KEY, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc",
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptToken("pina_secret", KEY);
    const b = encryptToken("pina_secret", KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain("pina_secret");
    expect(decryptToken(a, KEY)).toBe("pina_secret");
  });
  it("rejects tampering and wrong keys", () => {
    const enc = encryptToken("pina_secret", KEY);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptToken(parts.join("."), KEY)).toThrow();
    expect(() => decryptToken(enc, Buffer.alloc(32, 1).toString("base64"))).toThrow();
    expect(() => encryptToken("x", "short")).toThrow(/32 bytes/);
  });
});

describe("config", () => {
  it("lists exactly what is missing", () => {
    const c = checkPinterestConfig({ PINTEREST_CLIENT_ID: "x" });
    expect(c.ready).toBe(false);
    expect(c.missing).toContain("PINTEREST_CLIENT_SECRET");
    expect(c.missing).not.toContain("PINTEREST_CLIENT_ID");
  });
  it("defaults to sandbox with read-only scopes", () => {
    const cfg = getPinterestConfig(ENV);
    expect(cfg.env).toBe("sandbox");
    expect(cfg.apiBase).toBe("https://api-sandbox.pinterest.com/v5");
    expect(cfg.scopes).toEqual(["user_accounts:read", "boards:read", "pins:read"]);
    expect(getPinterestConfig({ ...ENV, PINTEREST_ENV: "production" }).tokenUrl).toBe("https://api.pinterest.com/v5/oauth/token");
  });
  it("builds the authorize URL with exact redirect and state", () => {
    const u = new URL(buildAuthorizeUrl(getPinterestConfig(ENV), "abc"));
    expect(u.origin + u.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(u.searchParams.get("redirect_uri")).toBe(ENV.PINTEREST_REDIRECT_URI);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("scope")).toBe("user_accounts:read,boards:read,pins:read");
  });
});

describe("OAuth state", () => {
  const now = 1_000_000;
  it("accepts the matching state for the same user", () => {
    const { state, cookie } = createState("macro", "user-1", "s3cret", now);
    expect(verifyState(cookie, state, "user-1", "s3cret", now + 1000)?.workspace).toBe("macro");
  });
  it("rejects wrong state, other user, forged signature and expiry", () => {
    const { state, cookie } = createState("fashion", "user-1", "s3cret", now);
    expect(verifyState(cookie, state + "x", "user-1", "s3cret", now)).toBeNull();
    expect(verifyState(cookie, state, "user-2", "s3cret", now)).toBeNull();
    expect(verifyState(cookie, state, "user-1", "other", now)).toBeNull();
    expect(verifyState(cookie, state, "user-1", "s3cret", now + 11 * 60_000)).toBeNull();
    expect(verifyState(undefined, state, "user-1", "s3cret", now)).toBeNull();
  });
});

describe("PinterestApi", () => {
  it("exchanges the code with HTTP Basic auth and form body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ access_token: "pina_1", refresh_token: "pinr_1", expires_in: 2592000 }));
    const api = new PinterestApi(getPinterestConfig(ENV), fetchFn);
    const t = await api.exchangeCode("CODE");
    expect(t.access_token).toBe("pina_1");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api-sandbox.pinterest.com/v5/oauth/token");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("cid:secret").toString("base64"));
    const body = new URLSearchParams(init.body);
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "CODE", redirect_uri: ENV.PINTEREST_REDIRECT_URI });
  });
  it("follows bookmarks and stops at the page cap", async () => {
    const pages = [json({ items: [{ id: "1" }], bookmark: "b1" }), json({ items: [{ id: "2" }], bookmark: "b2" }), json({ items: [{ id: "3" }], bookmark: null })];
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(pages.shift()));
    const api = new PinterestApi(getPinterestConfig(ENV), fetchFn);
    const all = await api.paginate<{ id: string }>("tok", "/boards", 10);
    expect(all).toEqual({ items: [{ id: "1" }, { id: "2" }, { id: "3" }], truncated: false });
    expect(new URL(fetchFn.mock.calls[1][0]).searchParams.get("bookmark")).toBe("b1");
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");

    const capped = new PinterestApi(getPinterestConfig(ENV), () => Promise.resolve(json({ items: [{ id: "x" }], bookmark: "more" })));
    expect((await capped.paginate("tok", "/pins", 2)).truncated).toBe(true);
  });
  it("turns rate limits into a typed error with retry-after", async () => {
    const api = new PinterestApi(getPinterestConfig(ENV), () => Promise.resolve(json({ code: 8, message: "Too many" }, 429, { "retry-after": "30" })));
    const err = await api.account("tok").catch((e) => e);
    expect(err).toBeInstanceOf(PinterestApiError);
    expect(err.isRateLimited).toBe(true);
    expect(describePinterestError(err)).toMatch(/30s/);
  });
});

describe("token refresh", () => {
  const now = Date.parse("2026-11-25T00:00:00Z");
  const base = { access_token: "old", refresh_token: "pinr", access_expires_at: new Date(now + 10 * 86400e3).toISOString(), refresh_expires_at: new Date(now + 50 * 86400e3).toISOString() };

  it("keeps a fresh token", async () => {
    const api = { refresh: vi.fn() };
    expect(await ensureAccessToken(api, base, vi.fn(), now)).toBe("old");
    expect(api.refresh).not.toHaveBeenCalled();
  });
  it("refreshes within 24h of expiry and persists the result", async () => {
    const api = { refresh: vi.fn().mockResolvedValue({ access_token: "new", expires_in: 2592000 }) };
    const saved = vi.fn().mockResolvedValue(undefined);
    const conn = { ...base, access_expires_at: new Date(now + 3600e3).toISOString() };
    expect(needsRefresh(conn.access_expires_at, now)).toBe(true);
    expect(await ensureAccessToken(api, conn, saved, now)).toBe("new");
    expect(saved).toHaveBeenCalledOnce();
  });
  it("asks to reconnect when refresh is refused or both tokens expired", async () => {
    const api = { refresh: vi.fn().mockRejectedValue(new PinterestApiError("bad", 401)) };
    const expiring = { ...base, access_expires_at: new Date(now - 1).toISOString() };
    await expect(ensureAccessToken(api, expiring, vi.fn(), now)).rejects.toBeInstanceOf(ReconnectRequired);
    await expect(
      ensureAccessToken({ refresh: vi.fn() }, { ...expiring, refresh_expires_at: new Date(now - 1).toISOString() }, vi.fn(), now),
    ).rejects.toBeInstanceOf(ReconnectRequired);
  });
  it("computes expiries from expires_in and refresh_token_expires_at", () => {
    const e = tokenExpiries({ access_token: "a", expires_in: 60, refresh_token_expires_at: 2_000_000_000 }, 0);
    expect(e.access).toBe(new Date(60_000).toISOString());
    expect(e.refresh).toBe(new Date(2_000_000_000_000).toISOString());
  });
});

describe("sync helpers", () => {
  it("fetches boards then pins and reports truncation", async () => {
    const paginate = vi.fn().mockResolvedValueOnce({ items: [{ id: "b" }], truncated: false }).mockResolvedValueOnce({ items: [{ id: "p" }], truncated: true });
    const r = await fetchBoardsAndPins({ paginate }, "tok");
    expect(paginate.mock.calls.map((c) => c[1])).toEqual(["/boards", "/pins"]);
    expect(r.truncated).toBe(true);
  });
  it("picks the largest pin image", () => {
    expect(pinImageUrl({ id: "1", media: { images: { "150x150": { url: "s", width: 150 }, "1200x": { url: "l", width: 1200 } } } })).toBe("l");
    expect(pinImageUrl({ id: "1" })).toBeNull();
  });
  it("explains PINNER_DATA_ACCESS_DENIED", () => {
    expect(describePinterestError(new PinterestApiError("x", 403, "PINNER_DATA_ACCESS_DENIED"))).toMatch(/business accounts/);
  });
});

describe("token key rotation", () => {
  const OLD = Buffer.alloc(32, 7).toString("base64");
  const NEW = Buffer.alloc(32, 9).toString("base64");
  it("reads tokens from the previous key and flags them for re-encryption", async () => {
    const { decryptToken: dec, encryptToken: enc, needsReencrypt } = await import("@/lib/crypto/tokens");
    const old = enc("pina_x", OLD);
    expect(() => dec(old, NEW, [])).toThrow(/no longer configured/);
    expect(dec(old, NEW, [OLD])).toBe("pina_x");
    expect(needsReencrypt(old, NEW)).toBe(true);
    expect(needsReencrypt(enc("pina_x", NEW), NEW)).toBe(false);
  });
  it("still reads the old v1 format", async () => {
    const { createCipheriv } = await import("node:crypto");
    const { decryptToken: dec, needsReencrypt } = await import("@/lib/crypto/tokens");
    const iv = Buffer.alloc(12, 1);
    const c = createCipheriv("aes-256-gcm", Buffer.from(OLD, "base64"), iv);
    const ct = Buffer.concat([c.update("legacy", "utf8"), c.final()]);
    const v1 = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
    expect(dec(v1, NEW, [OLD])).toBe("legacy");
    expect(needsReencrypt(v1, NEW)).toBe(true);
  });
});
