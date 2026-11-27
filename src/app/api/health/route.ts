import { connection, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkPinterestConfig } from "@/lib/pinterest/config";
import { getImageProvider } from "@/lib/ai/image";
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/** Liveness + configuration check for uptime monitors. Reveals no secrets. */
export async function GET() {
  await connection();
  const checks: Record<string, "ok" | "missing" | "error" | "demo"> = {};
  checks.storage = isSupabaseConfigured ? "ok" : "demo";
  if (isSupabaseConfigured) {
    try {
      const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { error } = await db.from("workspaces").select("id", { head: true, count: "exact" }).limit(1);
      checks.database = error ? "error" : "ok";
    } catch {
      checks.database = "error";
    }
    checks.service_role = process.env.SUPABASE_SERVICE_ROLE_KEY ? "ok" : "missing";
  }
  checks.text_ai = process.env.TEXT_AI_API_KEY ? "ok" : "demo";
  try {
    checks.image_ai = getImageProvider().source === "ai" ? "ok" : "demo";
  } catch {
    checks.image_ai = "error";
  }
  checks.pinterest = checkPinterestConfig().ready ? "ok" : "missing";
  // "missing" is fine when the Supabase scheduler (migration 0017) runs the jobs with its own secret.
  checks.cron_secret = process.env.CRON_SECRET ? "ok" : "missing";
  const ok = checks.database !== "error";
  return NextResponse.json({ ok, checks, time: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
