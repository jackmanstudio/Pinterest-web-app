import { NextResponse } from "next/server";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { audit } from "@/lib/workflow/server";
import { getAdminSupabase } from "@/lib/supabase/admin";

/** Downloads everything the signed-in user owns as JSON (no OAuth tokens). */
export async function GET(request: Request) {
  const limitedRes = rateLimited(request, "account");
  if (limitedRes) return limitedRes;
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(400, "In Demo mode, export from the browser instead.");
    const db = ctx.db;
    const tables = ["workspaces", "brand_settings", "categories", "pin_drafts", "publish_jobs", "audit_events", "ai_usage", "pinterest_boards", "pinterest_pins", "analytics_snapshots", "analytics_insights", "autopilot_settings", "autopilot_ideas"];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user: { id: ctx.user.id, email: ctx.user.email } };
    for (const t of tables) {
      const { data, error } = await db.from(t).select("*");
      if (error) throw new Error(`${t}: ${error.message}`);
      out[t] = data;
    }
    // Connection info without tokens (table is server-only).
    const wsIds = ((out.workspaces as { id: string }[]) ?? []).map((w) => w.id);
    const { data: conns } = await getAdminSupabase()
      .from("pinterest_connections")
      .select("workspace_id, environment, username, scopes, status, connected_at, last_synced_at")
      .in("workspace_id", wsIds.length ? wsIds : ["00000000-0000-0000-0000-000000000000"]);
    out.pinterest_connections = conns ?? [];
    for (const id of wsIds) await audit(getAdminSupabase(), { workspaceId: id, actorId: ctx.user.id, action: "data_exported", draftId: id });
    return new NextResponse(JSON.stringify(out, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="pinterest-ai-studio-export-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
