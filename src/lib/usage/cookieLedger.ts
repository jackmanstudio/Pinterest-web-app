import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { startOfMonthUtc } from "./pricing";
import type { UsageEntry, UsageLedger } from "./ledger";

/**
 * Demo-mode ledger kept in a signed, HttpOnly cookie in the visitor's browser.
 * Serverless instances don't share memory, so an in-memory ledger lost most
 * calls; the cookie follows the visitor to every instance. It covers this
 * browser only: a cap across all visitors needs Supabase (the Usage page says so).
 */
export const USAGE_COOKIE = "pas_usage";
const KEEP = 15;

type Compact = [number, 0 | 1, string, string | null, 0 | 1, number, number, number, number, 0 | 1, string];
interface Stored { m: string; spent: number; e: Compact[] }

function secret(): string | null {
  return process.env.AUTH_COOKIE_SECRET || process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CLOUDFLARE_API_TOKEN || process.env.ANTHROPIC_API_KEY || null;
}
const sign = (body: string, key: string) => createHmac("sha256", key).update(body).digest("base64url");
const month = (d = new Date()) => d.toISOString().slice(0, 7);

export function encodeUsage(s: Stored, key = secret()): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return key ? `${body}.${sign(body, key)}` : body;
}

export function decodeUsage(raw: string | undefined, key = secret(), now = new Date()): Stored {
  const empty: Stored = { m: month(now), spent: 0, e: [] };
  if (!raw) return empty;
  const [body, mac] = raw.split(".");
  if (key) {
    const want = sign(body, key);
    if (!mac || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return empty;
  }
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Stored;
    if (s.m !== month(now)) return { ...empty, e: (s.e ?? []).slice(0, KEEP) };
    return { m: s.m, spent: Number(s.spent) || 0, e: (s.e ?? []).slice(0, KEEP) };
  } catch {
    return empty;
  }
}

const toCompact = (e: UsageEntry): Compact => [
  Math.floor(Date.parse(e.created_at ?? new Date().toISOString()) / 1000), e.kind === "image" ? 1 : 0, e.provider.slice(0, 24), e.model?.replace(/^@[^/]+\/[^/]+\//, "").slice(0, 32) ?? null,
  e.source === "ai" ? 1 : 0, e.input_tokens, e.output_tokens, e.images, Math.round(e.est_cost_usd * 1e6) / 1e6, e.status === "ok" ? 1 : 0, e.workspace_kind ?? "",
];
const fromCompact = (c: Compact): UsageEntry => ({
  created_at: new Date(c[0] * 1000).toISOString(), kind: c[1] ? "image" : "text", provider: c[2], model: c[3], source: c[4] ? "ai" : "demo",
  input_tokens: c[5], output_tokens: c[6], images: c[7], est_cost_usd: c[8], status: c[9] ? "ok" : "error", error: c[9] ? null : "failed", workspace_kind: c[10] || undefined, workspace_id: null,
});

const ENTRY_PREFIX = "pas_u_";
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 40 * 86400 };

export function encodeEntry(c: Compact, key = secret()): string {
  const body = Buffer.from(JSON.stringify(c)).toString("base64url");
  return key ? `${body}.${sign(body, key)}` : body;
}
export function decodeEntry(raw: string, key = secret()): Compact | null {
  const [body, mac] = raw.split(".");
  if (key) {
    const want = sign(body, key);
    if (!mac || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  }
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString());
    return Array.isArray(c) && c.length === 11 ? (c as Compact) : null;
  } catch {
    return null;
  }
}

/**
 * Each call is its own small cookie, so parallel requests (two images at once)
 * never overwrite each other. Older calls are folded into a monthly total.
 */
export class CookieLedger implements UsageLedger {
  readonly mode = "browser" as const;

  private async read() {
    const jar = await cookies();
    const total = decodeUsage(jar.get(USAGE_COOKIE)?.value);
    const entries = jar
      .getAll()
      .filter((c) => c.name.startsWith(ENTRY_PREFIX))
      .map((c) => ({ name: c.name, c: decodeEntry(c.value) }))
      .filter((x): x is { name: string; c: Compact } => x.c !== null)
      .sort((a, b) => b.c[0] - a.c[0]);
    return { jar, total, entries };
  }
  async monthSpendUsd() {
    const { total, entries } = await this.read();
    const since = startOfMonthUtc().getTime() / 1000;
    return total.spent + entries.filter((x) => x.c[0] >= since).reduce((s, x) => s + x.c[8], 0);
  }
  async record(e: UsageEntry) {
    try {
      const { jar, total, entries } = await this.read();
      const c = toCompact({ ...e, created_at: e.created_at ?? new Date().toISOString() });
      jar.set(`${ENTRY_PREFIX}${c[0].toString(36)}${Math.random().toString(36).slice(2, 6)}`, encodeEntry(c), cookieOpts);
      const old = entries.slice(KEEP - 1);
      if (old.length) {
        const since = startOfMonthUtc().getTime() / 1000;
        const add = old.filter((x) => x.c[0] >= since).reduce((s, x) => s + x.c[8], 0);
        for (const x of old) jar.delete(x.name);
        jar.set(USAGE_COOKIE, encodeUsage({ m: total.m, spent: total.spent + add, e: [] }), cookieOpts);
      }
    } catch {
      /* cookies aren't writable here (e.g. while rendering a page) */
    }
  }
  async recent(limit: number) {
    return (await this.read()).entries.map((x) => fromCompact(x.c)).slice(0, limit);
  }
}
