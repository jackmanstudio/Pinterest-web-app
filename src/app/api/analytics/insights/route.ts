import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTextProvider } from "@/lib/ai/text";
import { ProviderError } from "@/lib/ai/text/types";
import { latestSnapshots } from "@/lib/analytics/server";
import { verifyInsights } from "@/lib/analytics/verify";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import { estimateTextCost } from "@/lib/usage/pricing";
import { WorkspaceSlug } from "@/lib/workspaces/schema";

const Body = z.object({ workspace: WorkspaceSlug });

/**
 * Growth insights agent. Runs only on stored, verified Pinterest snapshots and
 * drops any insight that quotes a number not present in that data.
 */
export async function POST(request: Request) {
  const limitedRes = rateLimited(request, "insights");
  if (limitedRes) return limitedRes;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const provider = getTextProvider();
    if (!provider.generateInsights || provider.source !== "ai") {
      throw new HttpError(409, "Insights need a real text AI key (TEXT_AI_API_KEY). The app won't invent analysis with demo templates.");
    }
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(503, "Insights need Supabase and Pinterest analytics.");
    const workspaceId = (await workspaceIdFor(ctx, parsed.data.workspace))!;
    const snaps = await latestSnapshots(ctx.db, workspaceId);
    if (!snaps.account) throw new HttpError(409, "Refresh Pinterest analytics first; insights only use real data.");

    const data = {
      account: snaps.account.data,
      top_pins: snaps.top_pins?.data ?? null,
      published_pins: snaps.published_pins?.data ?? null,
      trends: snaps.trends ? { params: snaps.trends.params, keywords: snaps.trends.data } : null,
    };
    await assertWithinBudget(ctx.ledger, true);
    const out = await provider.generateInsights({ workspace: parsed.data.workspace, dateRange: { start: snaps.account.start_date, end: snaps.account.end_date }, data });
    const { kept, dropped } = verifyInsights(out.insights, data);
    const cost = estimateTextCost(out.model, out.usage.input_tokens, out.usage.output_tokens);
    await ctx.ledger.record({
      workspace_id: workspaceId, workspace_kind: parsed.data.workspace, kind: "text", provider: provider.name, model: out.model, source: "ai",
      input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, images: 0, est_cost_usd: cost, status: "ok", error: null,
    });
    const ids = Object.values(snaps).map((s) => s!.id);
    const { error } = await getAdminSupabase()
      .from("analytics_insights")
      .insert({ workspace_id: workspaceId, snapshot_ids: ids, provider: provider.name, model: out.model, insights: kept, dropped: dropped.length });
    if (error) throw new Error(error.message);
    return NextResponse.json({ kept: kept.length, dropped: dropped.length });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message }, { status: 402 });
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("insights failed", err);
    return NextResponse.json({ error: "Could not generate insights." }, { status: 500 });
  }
}
