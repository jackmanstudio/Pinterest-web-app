import { NextResponse } from "next/server";

/**
 * Fixed-window rate limiter kept in server memory. Good for a single instance;
 * on multi-instance hosting, back it with Redis/Upstash (same interface).
 */
export const LIMITS = {
  generate: { limit: 20, windowMs: 60_000 },
  images: { limit: 10, windowMs: 60_000 },
  insights: { limit: 5, windowMs: 60_000 },
  pinterest: { limit: 10, windowMs: 60_000 },
  publish: { limit: 30, windowMs: 60_000 },
  account: { limit: 5, windowMs: 60_000 },
  autopilot: { limit: 20, windowMs: 60_000 },
  autopilotRun: { limit: 3, windowMs: 60_000 },
  urlCheck: { limit: 15, windowMs: 60_000 },
  errors: { limit: 10, windowMs: 60_000 },
  // Auth (spec 12): per IP, plus per email below, against brute force and email bombing.
  authLogin: { limit: 10, windowMs: 10 * 60_000 },
  authLoginEmail: { limit: 5, windowMs: 15 * 60_000 },
  authSignup: { limit: 5, windowMs: 60 * 60_000 },
  authEmail: { limit: 3, windowMs: 15 * 60_000 },
  authPassword: { limit: 5, windowMs: 15 * 60_000 },
} as const;
export type LimitName = keyof typeof LIMITS;

export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  check(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number; remaining: number } {
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + windowMs });
      return { ok: true, retryAfterSec: 0, remaining: limit - 1 };
    }
    if (cur.count >= limit) return { ok: false, retryAfterSec: Math.ceil((cur.reset - now) / 1000), remaining: 0 };
    cur.count++;
    return { ok: true, retryAfterSec: 0, remaining: limit - cur.count };
  }
}

const g = globalThis as unknown as { __rateLimiter?: RateLimiter };
const limiter = () => (g.__rateLimiter ??= new RateLimiter());

/** Identifies the caller by Supabase auth cookie subject if present, else by IP. */
export function callerKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const cookie = request.headers.get("cookie") ?? "";
  const session = /sb-[^=]+-auth-token(?:\.0)?=([^;]{12,40})/.exec(cookie)?.[1];
  return session ? `s:${session}` : `ip:${ip}`;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** Like rateLimited, but for an explicit key (e.g. IP or a hashed email) instead of the session. */
export function rateLimitedKey(name: LimitName, key: string): NextResponse | null {
  const { limit, windowMs } = LIMITS[name];
  const r = limiter().check(`${name}:${key}`, limit, windowMs);
  if (r.ok) return null;
  const mins = Math.ceil(r.retryAfterSec / 60);
  return NextResponse.json(
    { error: `Too many attempts. Please wait ${mins > 1 ? `${mins} minutes` : "a minute"} and try again.` },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export function rateLimited(request: Request, name: LimitName): NextResponse | null {
  const { limit, windowMs } = LIMITS[name];
  const r = limiter().check(`${name}:${callerKey(request)}`, limit, windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { error: `Too many requests. Try again in ${r.retryAfterSec}s.`, retryable: true },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}
