import { NextResponse } from "next/server";
import { dueGrowthWorkspaces, runGrowthAgent } from "@/lib/agents/server";
import { cronAuthorized } from "@/lib/server/cron";
import { log } from "@/lib/server/log";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Daily growth agent. Call once a day (or hourly: each account runs at most
 * once per ~20h) with `Authorization: Bearer $CRON_SECRET`. It only writes
 * suggestions; nothing is queued or published until the owner accepts.
 */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: "The growth agent needs Supabase" }, { status: 503 });
  const admin = getAdminSupabase();
  const started = Date.now();
  const results = [];
  for (const ws of await dueGrowthWorkspaces(admin)) {
    if (Date.now() - started > 240_000) break; // the rest run on the next call
    try {
      const r = await runGrowthAgent(admin, ws, "schedule");
      log("info", "growth_agent_run", { workspace_id: ws.workspace_id, ...r });
      results.push({ workspace_id: ws.workspace_id, ...r });
    } catch (err) {
      log("error", "growth_agent_failed", { workspace_id: ws.workspace_id, error: err });
      results.push({ workspace_id: ws.workspace_id, status: "failed", detail: (err as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}

export const GET = handle;
export const POST = handle;
