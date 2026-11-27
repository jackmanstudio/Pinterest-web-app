import { NextResponse } from "next/server";
import { runAutopilotStep } from "@/lib/autopilot/engine";
import { enabledWorkspaces, supabaseAutopilotDeps } from "@/lib/autopilot/server";
import { cronAuthorized } from "@/lib/server/cron";
import { log } from "@/lib/server/log";
import { recordWorkerRun } from "@/lib/server/workerRuns";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Autopilot tick. Call hourly with `Authorization: Bearer $CRON_SECRET`.
 * Each enabled workspace publishes at most one pin per tick, within its daily limit.
 */
async function handle(request: Request) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: "Autopilot needs Supabase" }, { status: 503 });
  const admin = getAdminSupabase();
  const deps = supabaseAutopilotDeps(admin);
  const results = [];
  for (const ws of await enabledWorkspaces(admin)) {
    try {
      const outcome = await runAutopilotStep(ws, deps);
      log("info", "autopilot_step", { workspace_id: ws.workspace_id, ...outcome });
      results.push({ workspace_id: ws.workspace_id, ...outcome });
    } catch (err) {
      log("error", "autopilot_step_failed", { workspace_id: ws.workspace_id, error: err });
      results.push({ workspace_id: ws.workspace_id, action: "failed", detail: (err as Error).message });
    }
  }
  await recordWorkerRun(admin, "autopilot", true, { processed: results.length, failed: results.filter((r) => r.action === "failed").length });
  return NextResponse.json({ processed: results.length, results });
}

export const GET = handle;
export const POST = handle;
