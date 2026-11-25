import { NextResponse } from "next/server";
import { PinterestApi } from "@/lib/pinterest/api";
import { checkPinterestConfig, getPinterestConfig } from "@/lib/pinterest/config";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { runPublishJob } from "@/lib/workflow/runner";
import { supabaseRunnerDeps } from "@/lib/workflow/server";
import { cronAuthorized } from "@/lib/server/cron";

/**
 * Publishes approved, scheduled pins whose time has come. Call every few
 * minutes from a scheduler (e.g. Vercel Cron) with `Authorization: Bearer $CRON_SECRET`.
 * Pinterest has no organic scheduling API, so the app runs the schedule itself.
 */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkPinterestConfig().ready) return NextResponse.json({ error: "Pinterest not configured" }, { status: 503 });
  const cfg = getPinterestConfig();
  const admin = getAdminSupabase();
  const deps = supabaseRunnerDeps(admin, new PinterestApi(cfg), new ConnectionRepo(admin, cfg.encryptionKey));

  const { data, error } = await admin
    .from("publish_jobs")
    .select("id")
    .eq("status", "queued")
    .lte("run_at", new Date().toISOString())
    .order("run_at")
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const { id } of data ?? []) results.push({ id, ...(await runPublishJob(id, deps)) });
  return NextResponse.json({ processed: results.length, results });
}

export const GET = handle;
export const POST = handle;
