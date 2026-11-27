import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getAdminSupabase, hasAdminSupabase } from "@/lib/supabase/admin";

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") && h.length > 7 && h.length < 300 ? h.slice(7) : null;
}

/** Constant-time match against `Bearer $CRON_SECRET` (Vercel Cron / an external scheduler). */
export function envCronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * True for a scheduler call: either the CRON_SECRET env var, or the secret
 * that Supabase generated and keeps in its Vault (migration 0017). The second
 * lets Supabase pg_cron run the jobs without anyone copying a secret around.
 */
export async function cronAuthorized(request: Request): Promise<boolean> {
  if (envCronAuthorized(request)) return true;
  const token = bearer(request);
  if (!token || !hasAdminSupabase()) return false;
  const { data, error } = await getAdminSupabase().rpc("verify_cron_secret", { p_token: token });
  return !error && data === true;
}
