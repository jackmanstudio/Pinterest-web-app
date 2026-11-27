import { NextResponse } from "next/server";
import { PinterestApi } from "@/lib/pinterest/api";
import { checkPinterestConfig, getPinterestConfig } from "@/lib/pinterest/config";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { runPublishJob } from "@/lib/workflow/runner";
import { supabaseRunnerDeps } from "@/lib/workflow/server";
import { cronAuthorized } from "@/lib/server/cron";
import { log } from "@/lib/server/log";
import { recordWorkerRun } from "@/lib/server/workerRuns";

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

  // Jobs whose worker died mid-publish go back to the queue as "uncertain" (migration 0011).
  const recovered = await admin.rpc("recover_stale_publish_jobs");
  if (recovered.error && !/recover_stale_publish_jobs/.test(recovered.error.message)) log("warn", "job_recovery_failed", { error: recovered.error.message });

  // Paused accounts keep their jobs queued; they publish after Resume (migration 0016).
  const paused = await admin.from("workspaces").select("id").eq("publishing_paused", true);
  const pausedIds = paused.error ? [] : (paused.data ?? []).map((w) => w.id as string);

  let q = admin.from("publish_jobs").select("id").eq("status", "queued").lte("run_at", new Date().toISOString());
  if (pausedIds.length) q = q.not("workspace_id", "in", `(${pausedIds.join(",")})`);
  const { data, error } = await q.order("run_at").limit(20);
  if (error) {
    await recordWorkerRun(admin, "publish-due", false, { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: ({ id: string } & Awaited<ReturnType<typeof runPublishJob>>)[] = [];
  for (const { id } of data ?? []) results.push({ id, ...(await runPublishJob(id, deps)) });
  const tally = (s: string) => results.filter((r) => r.status === s).length;
  await recordWorkerRun(admin, "publish-due", true, {
    processed: results.length,
    succeeded: tally("succeeded"),
    retrying: tally("retrying"),
    failed: tally("failed"),
    paused_accounts: pausedIds.length,
  });
  return NextResponse.json({ processed: results.length, paused_accounts: pausedIds.length, results });
}

export const GET = handle;
export const POST = handle;
