import { connection, NextResponse } from "next/server";
import { latestSnapshots } from "@/lib/analytics/server";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { checkPinterestConfig } from "@/lib/pinterest/config";
import { getTextProvider } from "@/lib/ai/text";
import { isWorkspaceKind } from "@/lib/types";

/** Latest stored analytics + insights for a workspace (read via RLS). */
export async function GET(request: Request) {
  await connection();
  const kind = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!isWorkspaceKind(kind)) return NextResponse.json({ error: "Unknown workspace" }, { status: 400 });
  const text = getTextProvider();
  const base = { pinterestConfigured: checkPinterestConfig().ready, insightsAvailable: Boolean(text.generateInsights), textProvider: text.name };
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") return NextResponse.json({ ...base, mode: "demo", snapshots: {}, insights: null });
    const ws = (await workspaceIdFor(ctx, kind))!;
    const [snapshots, insights] = await Promise.all([
      latestSnapshots(ctx.db, ws),
      ctx.db.from("analytics_insights").select("id, provider, model, insights, dropped, snapshot_ids, created_at").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return NextResponse.json({ ...base, mode: "supabase", snapshots, insights: insights.data ?? null });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
