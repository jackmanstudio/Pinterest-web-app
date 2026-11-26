import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { getTextProvider } from "@/lib/ai/text";
import { acceptSuggestion, NEEDS_AGENT_MIGRATION, runGrowthAgent } from "@/lib/agents/server";
import { getRequestContext, HttpError, workspaceFor } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { isMissingTable } from "@/lib/supabase/compat";
import { isWorkspaceKind } from "@/lib/types";
import { WorkspaceSlug } from "@/lib/workspaces/schema";

export const maxDuration = 120;

function fail(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  const msg = (err as Error).message ?? "Something went wrong";
  if (msg === NEEDS_AGENT_MIGRATION) return NextResponse.json({ error: msg, needsMigration: true }, { status: 409 });
  console.error("growth agent route failed", err);
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** Growth agent state for one account: settings, last runs and waiting suggestions. */
export async function GET(request: Request) {
  await connection();
  const kind = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!isWorkspaceKind(kind)) return NextResponse.json({ error: "Unknown workspace" }, { status: 400 });
  try {
    const ctx = await getRequestContext();
    const provider = getTextProvider();
    const engine = provider.source === "ai" && provider.generateGrowthIdeas ? provider.name : "Rules (no text AI)";
    if (ctx.mode === "demo") return NextResponse.json({ mode: "demo", engine });
    const { id } = await workspaceFor(ctx, kind);
    const [settings, runs, suggestions] = await Promise.all([
      ctx.db.from("agent_settings").select("growth_enabled, ideas_per_run").eq("workspace_id", id).maybeSingle(),
      ctx.db.from("agent_runs").select("id, trigger, status, provider, kept, dropped, detail, created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(5),
      ctx.db.from("agent_suggestions").select("id, idea, reason, evidence, signal, ref, status, created_at, decided_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(40),
    ]);
    if ([settings, runs, suggestions].some((r) => isMissingTable(r.error))) return NextResponse.json({ mode: "supabase", engine, needsMigration: true, error: NEEDS_AGENT_MIGRATION });
    for (const r of [settings, runs, suggestions]) if (r.error) throw new Error(r.error.message);
    return NextResponse.json({
      mode: "supabase",
      engine,
      settings: settings.data ?? { growth_enabled: false, ideas_per_run: 5 },
      runs: runs.data,
      suggestions: suggestions.data,
    });
  } catch (err) {
    return fail(err);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), workspace: WorkspaceSlug }),
  z.object({ action: z.literal("settings"), workspace: WorkspaceSlug, growth_enabled: z.boolean(), ideas_per_run: z.number().int().min(1).max(6) }),
  z.object({ action: z.literal("accept"), workspace: WorkspaceSlug, id: z.uuid() }),
  z.object({ action: z.literal("dismiss"), workspace: WorkspaceSlug, id: z.uuid() }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  const limited = rateLimited(request, b.action === "run" ? "agentRun" : "autopilot");
  if (limited) return limited;
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(503, "The growth agent needs Supabase.");
    // Ownership is checked with the user's own session (RLS) before any service-role write.
    const { id: workspaceId } = await workspaceFor(ctx, b.workspace);
    const admin = getAdminSupabase();
    if (b.action === "settings") {
      const res = await ctx.db.from("agent_settings").upsert({ workspace_id: workspaceId, growth_enabled: b.growth_enabled, ideas_per_run: b.ideas_per_run });
      if (res.error) throw new Error(isMissingTable(res.error) ? NEEDS_AGENT_MIGRATION : res.error.message);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "run") {
      const result = await runGrowthAgent(admin, { workspace_id: workspaceId, owner_id: ctx.user.id, slug: b.workspace }, "manual");
      return NextResponse.json(result);
    }
    if (b.action === "accept") {
      const ideaId = await acceptSuggestion(admin, workspaceId, b.id);
      return NextResponse.json({ ok: true, idea_id: ideaId });
    }
    const res = await admin
      .from("agent_suggestions")
      .update({ status: "dismissed", decided_at: new Date().toISOString() })
      .eq("id", b.id)
      .eq("workspace_id", workspaceId)
      .eq("status", "suggested")
      .select("id");
    if (res.error) throw new Error(res.error.message);
    if (!res.data?.length) throw new HttpError(409, "This idea was already handled.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
