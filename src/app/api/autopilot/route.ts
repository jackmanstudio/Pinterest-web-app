import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { CONSENT_PHRASE, MAX_PINS_PER_DAY, runAutopilotStep } from "@/lib/autopilot/engine";
import { enabledWorkspaces, loadPinSamples, serverReadiness, supabaseAutopilotDeps } from "@/lib/autopilot/server";
import { bestPostingHours } from "@/lib/autopilot/bestTime";
import { getPinterestConfig } from "@/lib/pinterest/config";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { WORKSPACE_KINDS, isWorkspaceKind } from "@/lib/types";
import { audit } from "@/lib/workflow/server";
import { isMissingColumn, isMissingTable } from "@/lib/supabase/compat";

const NEEDS_SOURCES = "Content sources need a database update. Run supabase/migrations/0012_content_sources.sql in the Supabase SQL editor.";

function fail(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("autopilot route failed", err);
  return NextResponse.json({ error: (err as Error).message ?? "Something went wrong" }, { status: 500 });
}

export const maxDuration = 300;

export async function GET(request: Request) {
  await connection();
  const kind = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!isWorkspaceKind(kind)) return NextResponse.json({ error: "Unknown workspace" }, { status: 400 });
  try {
    const ctx = await getRequestContext();
    const readiness = serverReadiness();
    if (ctx.mode === "demo") {
      return NextResponse.json({ mode: "demo", readiness: ["Connect Supabase (Autopilot runs on the server, so it needs a real database).", ...readiness] });
    }
    const workspaceId = (await workspaceIdFor(ctx, kind))!;
    const sources = await ctx.db.from("content_sources").select("id, url, kind, enabled, last_checked_at, last_error").eq("workspace_id", workspaceId).order("created_at");
    const [settings, ideas, boards, recent] = await Promise.all([
      ctx.db.from("autopilot_settings").select("enabled, board_id, board_name, pins_per_day, link, enabled_at, paused_reason, last_run_at, timezone, best_time, remix_winners, auto_trends, trend_interest").eq("workspace_id", workspaceId).maybeSingle(),
      ctx.db.from("autopilot_ideas").select("id, idea, status, error, source, created_at, processed_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50),
      ctx.db.from("pinterest_boards").select("board_id, name").eq("workspace_id", workspaceId).order("name"),
      ctx.db.from("pin_drafts").select("id, title, status, external_pin_id, published_at, review_note, image_status").eq("workspace_id", workspaceId).eq("autopilot", true).order("created_at", { ascending: false }).limit(20),
    ]);
    for (const r of [settings, ideas, boards, recent]) if (r.error) throw new Error(r.error.message);
    let connected = false;
    try {
      const info = await new ConnectionRepo(getAdminSupabase(), getPinterestConfig().encryptionKey).info(workspaceId);
      connected = info?.status === "active";
    } catch {
      /* Pinterest not configured: reported in readiness */
    }
    if (!connected) readiness.push("Connect Pinterest to this workspace (Pinterest tab), then sync boards.");
    const tz = (settings.data?.timezone as string | undefined) ?? "UTC";
    const bestTime = bestPostingHours((await loadPinSamples(ctx.db, workspaceId)).samples, tz);
    return NextResponse.json({
      mode: "supabase",
      settings: settings.data ?? {
        enabled: false, board_id: null, board_name: null, pins_per_day: 3, link: null, enabled_at: null, paused_reason: null, last_run_at: null,
        timezone: "UTC", best_time: true, remix_winners: true, auto_trends: false, trend_interest: kind === "fashion" ? "womens_fashion" : null,
      },
      bestTime,
      ideas: ideas.data,
      sources: sources.error ? [] : sources.data,
      sourcesNeedMigration: isMissingTable(sources.error),
      boards: boards.data,
      recent: recent.data,
      readiness,
    });
  } catch (err) {
    return fail(err);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    workspace: z.enum(WORKSPACE_KINDS),
    enabled: z.boolean(),
    consent: z.string().max(40).optional(),
    boardId: z.string().max(64).nullable(),
    boardName: z.string().max(200).nullable(),
    pinsPerDay: z.number().int().min(1).max(MAX_PINS_PER_DAY),
    link: z.url().max(2000).nullable().or(z.literal("").transform(() => null)),
    timezone: z.string().min(1).max(64).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone").default("UTC"),
    bestTime: z.boolean().default(true),
    remixWinners: z.boolean().default(true),
    autoTrends: z.boolean().default(false),
    trendInterest: z.enum(["womens_fashion", "mens_fashion", "beauty", "home_decor", "food_and_drinks", "travel", "art", "design"]).nullable().default(null),
  }),
  z.object({ action: z.literal("add_ideas"), workspace: z.enum(WORKSPACE_KINDS), ideas: z.array(z.string().trim().min(3).max(500)).min(1).max(100) }),
  z.object({
    action: z.literal("add_pages"),
    workspace: z.enum(WORKSPACE_KINDS),
    pages: z
      .array(z.object({ idea: z.string().trim().min(3).max(500), link: z.url().max(2048), context: z.string().max(2000).optional(), image_urls: z.array(z.url().max(2048)).max(6).default([]) }))
      .min(1)
      .max(50),
  }),
  z.object({ action: z.literal("add_source"), workspace: z.enum(WORKSPACE_KINDS), url: z.string().trim().min(8).max(2048) }),
  z.object({ action: z.literal("toggle_source"), workspace: z.enum(WORKSPACE_KINDS), id: z.uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("delete_source"), workspace: z.enum(WORKSPACE_KINDS), id: z.uuid() }),
  z.object({ action: z.literal("delete_idea"), workspace: z.enum(WORKSPACE_KINDS), id: z.uuid() }),
  z.object({ action: z.literal("run_now"), workspace: z.enum(WORKSPACE_KINDS) }),
  z.object({ action: z.literal("pause"), workspace: z.enum(WORKSPACE_KINDS) }),
]);

export async function POST(request: Request) {
  const limited = rateLimited(request, "autopilot");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const b = parsed.data;
  try {
    const ctx = await getRequestContext();
    if (ctx.mode === "demo") throw new HttpError(503, "Autopilot needs Supabase, Pinterest and AI keys on the server.");
    const workspaceId = (await workspaceIdFor(ctx, b.workspace))!;

    if (b.action === "save") {
      const prev = await ctx.db.from("autopilot_settings").select("enabled").eq("workspace_id", workspaceId).maybeSingle();
      const turningOn = b.enabled && !prev.data?.enabled;
      if (turningOn && b.consent !== CONSENT_PHRASE) throw new HttpError(422, `Type ${CONSENT_PHRASE} to confirm automatic publishing.`);
      if (b.enabled && !b.boardId) throw new HttpError(422, "Choose the board Autopilot should post to.");
      const res = await ctx.db.from("autopilot_settings").upsert({
        workspace_id: workspaceId, enabled: b.enabled, consent_text: b.enabled ? CONSENT_PHRASE : null,
        board_id: b.boardId, board_name: b.boardName, pins_per_day: b.pinsPerDay, link: b.link,
        timezone: b.timezone, best_time: b.bestTime, remix_winners: b.remixWinners, auto_trends: b.autoTrends, trend_interest: b.trendInterest,
      });
      if (res.error) throw new Error(res.error.message);
      if (b.enabled !== Boolean(prev.data?.enabled)) {
        await audit(getAdminSupabase(), {
          workspaceId, actorId: ctx.user.id, action: b.enabled ? "autopilot_enabled" : "autopilot_paused", draftId: workspaceId,
          details: { board_id: b.boardId, pins_per_day: b.pinsPerDay },
        });
      }
      return NextResponse.json({ ok: true });
    }
    if (b.action === "pause") {
      // Emergency stop: turning off also clears the consent, so it must be re-typed to resume.
      const res = await ctx.db.from("autopilot_settings").update({ enabled: false, consent_text: null }).eq("workspace_id", workspaceId).eq("enabled", true).select("workspace_id");
      if (res.error) throw new Error(res.error.message);
      if (res.data?.length) {
        await audit(getAdminSupabase(), { workspaceId, actorId: ctx.user.id, action: "autopilot_paused", draftId: workspaceId, details: { via: "pause_all" } });
      }
      return NextResponse.json({ ok: true, paused: Boolean(res.data?.length) });
    }
    if (b.action === "add_ideas") {
      const res = await ctx.db.from("autopilot_ideas").insert(b.ideas.map((idea) => ({ workspace_id: workspaceId, idea })));
      if (res.error) throw new Error(res.error.message);
      return NextResponse.json({ ok: true, added: b.ideas.length });
    }
    if (b.action === "add_pages") {
      const res = await ctx.db.from("autopilot_ideas").insert(b.pages.map((p) => ({ workspace_id: workspaceId, idea: p.idea, link: p.link, context: p.context ?? null, image_urls: p.image_urls })));
      if (res.error) throw new Error(isMissingColumn(res.error) ? NEEDS_SOURCES : res.error.message);
      return NextResponse.json({ ok: true, added: b.pages.length });
    }
    if (b.action === "add_source") {
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(b.url) ? b.url : `https://${b.url}`);
      } catch {
        throw new HttpError(400, "That isn't a valid web address.");
      }
      const res = await ctx.db.from("content_sources").insert({ workspace_id: workspaceId, url: url.toString() });
      if (res.error) {
        if (isMissingTable(res.error)) throw new HttpError(409, NEEDS_SOURCES);
        if (res.error.code === "23505") throw new HttpError(409, "That source is already added.");
        throw new HttpError(400, /at most 10/.test(res.error.message) ? "You can add up to 10 sources per account." : res.error.message);
      }
      return NextResponse.json({ ok: true });
    }
    if (b.action === "toggle_source" || b.action === "delete_source") {
      const q = b.action === "toggle_source" ? ctx.db.from("content_sources").update({ enabled: b.enabled }) : ctx.db.from("content_sources").delete();
      const res = await q.eq("id", b.id).eq("workspace_id", workspaceId);
      if (res.error) throw new Error(res.error.message);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "delete_idea") {
      const res = await ctx.db.from("autopilot_ideas").delete().eq("id", b.id).eq("workspace_id", workspaceId);
      if (res.error) throw new Error(res.error.message);
      return NextResponse.json({ ok: true });
    }
    // run_now: one Autopilot step for this workspace, same limits as the scheduler.
    const again = rateLimited(request, "autopilotRun");
    if (again) return again;
    const admin = getAdminSupabase();
    const [ws] = await enabledWorkspaces(admin, workspaceId);
    if (!ws) throw new HttpError(409, "Turn Autopilot on first.");
    const outcome = await runAutopilotStep(ws, supabaseAutopilotDeps(admin));
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    return fail(err);
  }
}
