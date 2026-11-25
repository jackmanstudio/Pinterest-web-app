import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dateRange, parseAccountAnalytics, parsePinSummary, parseTopPins } from "@/lib/analytics/parse";
import { analyticsCalls, saveSnapshot } from "@/lib/analytics/server";
import type { PublishedPinStats } from "@/lib/analytics/types";
import { pinterestContext } from "@/lib/pinterest/server";
import { describePinterestError, ensureAccessToken, ReconnectRequired } from "@/lib/pinterest/sync";
import { HttpError } from "@/lib/server/context";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { WORKSPACE_KINDS } from "@/lib/types";

const Body = z.object({ workspace: z.enum(WORKSPACE_KINDS), days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) });

/** Pulls verified analytics from Pinterest and stores each response as a snapshot. Read-only. */
export async function POST(request: Request) {
  const limitedRes = rateLimited(request, "pinterest");
  if (limitedRes) return limitedRes;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  let pc: Awaited<ReturnType<typeof pinterestContext>>;
  try {
    pc = await pinterestContext(parsed.data.workspace);
  } catch (err) {
    const e = err as HttpError;
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
  const { api, repo, cfg, workspaceId } = pc;
  const conn = await repo.get(workspaceId);
  if (!conn) return NextResponse.json({ error: "Connect a Pinterest account to this workspace first." }, { status: 409 });

  const admin = getAdminSupabase();
  const calls = analyticsCalls(api);
  const { start, end } = dateRange(parsed.data.days);
  const env = cfg.env;
  const sections: Record<string, { ok: boolean; error?: string }> = {};

  let token: string;
  try {
    token = await ensureAccessToken(api, conn, (t) => repo.updateTokens(workspaceId, t, conn.refresh_token));
  } catch (err) {
    if (err instanceof ReconnectRequired) await repo.markNeedsReconnect(workspaceId, err.message);
    return NextResponse.json({ error: describePinterestError(err) }, { status: 401 });
  }

  try {
    const raw = await calls.account(token, start, end);
    await saveSnapshot(admin, { workspaceId, kind: "account", source: "Pinterest API v5 · GET /user_account/analytics", environment: env, start, end, params: { days: parsed.data.days }, data: parseAccountAnalytics(raw) });
    sections.account = { ok: true };
  } catch (err) {
    sections.account = { ok: false, error: describePinterestError(err) };
  }

  try {
    const raw = await calls.topPins(token, start, end);
    await saveSnapshot(admin, { workspaceId, kind: "top_pins", source: "Pinterest API v5 · GET /user_account/analytics/top_pins (sorted by saves)", environment: env, start, end, data: parseTopPins(raw) });
    sections.top_pins = { ok: true };
  } catch (err) {
    sections.top_pins = { ok: false, error: describePinterestError(err) };
  }

  // Pins this studio published in this workspace.
  const { data: published } = await admin
    .from("pin_drafts")
    .select("id, title, external_pin_id")
    .eq("workspace_id", workspaceId)
    .not("external_pin_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(25);
  const stats: PublishedPinStats[] = [];
  for (const p of published ?? []) {
    try {
      stats.push({ pin_id: p.external_pin_id, draft_id: p.id, title: p.title, summary: parsePinSummary(await calls.pin(token, p.external_pin_id, start, end)) });
    } catch (err) {
      stats.push({ pin_id: p.external_pin_id, draft_id: p.id, title: p.title, summary: {}, error: describePinterestError(err) });
    }
  }
  await saveSnapshot(admin, { workspaceId, kind: "published_pins", source: "Pinterest API v5 · GET /pins/{id}/analytics", environment: env, start, end, data: stats });
  sections.published_pins = { ok: true };

  return NextResponse.json({ start, end, sections });
}
