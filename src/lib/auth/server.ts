import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const RECOVERY_COOKIE = "pas_recovery";

/** Rejects cross-site POSTs (defence in depth on top of SameSite cookies + JSON bodies). */
export function crossSite(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null; // same-origin fetches from older browsers / server tools
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    /* fall through */
  }
  return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
}

export function notConfigured(): NextResponse | null {
  return isSupabaseConfigured ? null : NextResponse.json({ error: "Accounts are off in Demo mode (Supabase isn't configured)." }, { status: 503 });
}

/**
 * Old address that browsers flagged (a "pinterest" vercel.app domain with a sign-in form looked like a
 * Pinterest imitation). Email links always point at the new address, even if the env var still names the old one.
 */
const RETIRED_HOSTS = new Set(["pinterest-web-app.vercel.app"]);
export const PRIMARY_ORIGIN = "https://pin-ai-studio.vercel.app";

/** The site's own origin for email links (Supabase also checks it against its allow-list). */
export function siteOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  const origin = env && /^https?:\/\//.test(env) ? env.replace(/\/$/, "") : new URL(request.url).origin;
  return RETIRED_HOSTS.has(new URL(origin).host) ? PRIMARY_ORIGIN : origin;
}

/** Rate-limit key for an email without keeping the address itself in memory. */
export const emailKey = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32);

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

const g = globalThis as unknown as { __pasAuthSecret?: string };
function secret(): string {
  const env = process.env.AUTH_COOKIE_SECRET || process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return env || (g.__pasAuthSecret ??= randomBytes(32).toString("hex"));
}

/** Signed "this user just opened a reset link" marker: userId.expiry.hmac. */
export function signRecovery(userId: string, ttlMs = 15 * 60_000, now = Date.now()): string {
  const exp = now + ttlMs;
  const mac = createHmac("sha256", secret()).update(`recovery:${userId}:${exp}`).digest("base64url");
  return `${userId}.${exp}.${mac}`;
}
export function verifyRecovery(value: string | undefined, userId: string, now = Date.now()): boolean {
  if (!value) return false;
  const [id, expStr, mac] = value.split(".");
  const exp = Number(expStr);
  if (id !== userId || !Number.isFinite(exp) || exp < now || !mac) return false;
  const want = createHmac("sha256", secret()).update(`recovery:${id}:${exp}`).digest();
  const got = Buffer.from(mac, "base64url");
  return got.length === want.length && timingSafeEqual(got, want);
}
