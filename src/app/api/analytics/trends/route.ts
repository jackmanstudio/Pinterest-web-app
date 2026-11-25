import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseTrends } from "@/lib/analytics/parse";
import { analyticsCalls, saveSnapshot } from "@/lib/analytics/server";
import { PinterestApiError } from "@/lib/pinterest/api";
import { pinterestContext } from "@/lib/pinterest/server";
import { describePinterestError, ensureAccessToken } from "@/lib/pinterest/sync";
import { HttpError } from "@/lib/server/context";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { WORKSPACE_KINDS } from "@/lib/types";

const TREND_REGIONS = ["US", "CA", "GB+IE", "AU+NZ", "DE", "FR"] as const;
const Body = z.object({
  workspace: z.enum(WORKSPACE_KINDS),
  region: z.enum(TREND_REGIONS).default("US"),
  type: z.enum(["growing", "monthly", "yearly", "seasonal"]).default("growing"),
  interest: z.enum(["womens_fashion", "mens_fashion", "beauty", "home_decor", "food_and_drinks", "travel", "art", "design"]).optional(),
});

/** Pinterest Trends (official endpoint). Stored with source and date; never estimated. */
export async function POST(request: Request) {
  const limitedRes = rateLimited(request, "pinterest");
  if (limitedRes) return limitedRes;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { api, repo, cfg, workspaceId } = await pinterestContext(parsed.data.workspace);
    const conn = await repo.get(workspaceId);
    if (!conn) throw new HttpError(409, "Connect a Pinterest account to this workspace first.");
    const token = await ensureAccessToken(api, conn, (t) => repo.updateTokens(workspaceId, t, conn.refresh_token));
    const raw = await analyticsCalls(api).trends(token, parsed.data.region, parsed.data.type, parsed.data.interest);
    const trends = parseTrends(raw);
    const today = new Date().toISOString().slice(0, 10);
    await saveSnapshot(getAdminSupabase(), {
      workspaceId, kind: "trends", source: "Pinterest API v5 · GET /trends/keywords/{region}/top/{trend_type}", environment: cfg.env,
      end: today, params: { region: parsed.data.region, type: parsed.data.type, interest: parsed.data.interest ?? null }, data: trends,
    });
    return NextResponse.json({ count: trends.length });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof PinterestApiError && (err.status === 403 || err.status === 404)) {
      return NextResponse.json({ error: "Pinterest Trends isn't available for this app or account (access not granted)." }, { status: 403 });
    }
    return NextResponse.json({ error: describePinterestError(err) }, { status: 502 });
  }
}
