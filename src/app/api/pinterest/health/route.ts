import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { checkPinterestConfig } from "@/lib/pinterest/config";
import { pinterestContext } from "@/lib/pinterest/server";
import { describePinterestError, ReconnectRequired } from "@/lib/pinterest/sync";
import { PinterestApiError, type PinterestBoard } from "@/lib/pinterest/api";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { readWorkerRuns, workerState } from "@/lib/server/workerRuns";
import { getAdminSupabase, hasAdminSupabase } from "@/lib/supabase/admin";
import { isWorkspaceKind } from "@/lib/types";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { errorResponse } from "@/lib/server/errors";

function tokenState(expiresAt: string | null | undefined, now = Date.now()): "ok" | "expiring" | "expired" | "unknown" {
  if (!expiresAt) return "unknown";
  const left = Date.parse(expiresAt) - now;
  return left <= 0 ? "expired" : left < 3 * 86_400_000 ? "expiring" : "ok";
}

/**
 * Integration check for one account: settings, connection, token expiry,
 * worker heartbeats, queue counts and the latest publish jobs. Never returns tokens.
 */
export async function GET(request: Request) {
  await connection();
  const kind = new URL(request.url).searchParams.get("workspace") ?? "";
  if (!isWorkspaceKind(kind)) return NextResponse.json({ error: "Unknown workspace" }, { status: 400 });
  const config = checkPinterestConfig();
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") return NextResponse.json({ config, demo: true });
    const workspaceId = (await workspaceIdFor(ctx, kind))!; // ownership check (RLS)
    const admin = hasAdminSupabase() ? getAdminSupabase() : null;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [conn, ws, jobs, workers] = await Promise.all([
      admin
        ? admin.from("pinterest_connections").select("environment, username, account_type, scopes, status, access_expires_at, refresh_expires_at, sync_status, sync_error, last_synced_at, connected_at").eq("workspace_id", workspaceId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      ctx.db.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
      ctx.db.from("publish_jobs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(25),
      admin ? readWorkerRuns(admin) : Promise.resolve(null),
    ]);
    const jobRows = (jobs.data ?? []) as Record<string, unknown>[];
    const titles = new Map<string, string>();
    const ids = [...new Set(jobRows.map((j) => j.draft_id as string))];
    if (ids.length) {
      const d = await ctx.db.from("pin_drafts").select("id, title").in("id", ids);
      for (const r of d.data ?? []) titles.set(r.id as string, r.title as string);
    }
    const recent = jobRows.filter((j) => String(j.created_at) >= since);
    const count = (s: string) => recent.filter((j) => j.status === s).length;
    const lastFailed = jobRows.find((j) => j.last_error);
    const c = conn.data as Record<string, string | string[] | null> | null;
    const byName = new Map((workers ?? []).map((w) => [w.name, w]));

    return NextResponse.json({
      config,
      connection: c,
      token: { access: tokenState(c?.access_expires_at as string | null), login: tokenState((c?.refresh_expires_at as string | null) ?? null) },
      paused: Boolean((ws.data as { publishing_paused?: boolean } | null)?.publishing_paused),
      pauseSupported: ws.data ? "publishing_paused" in ws.data : false,
      workers:
        workers === null
          ? null
          : {
              publish: { state: workerState(byName.get("publish-due"), 5), last_run_at: byName.get("publish-due")?.last_run_at ?? null, result: byName.get("publish-due")?.last_result ?? null },
              autopilot: { state: workerState(byName.get("autopilot"), 60), last_run_at: byName.get("autopilot")?.last_run_at ?? null },
            },
      queue: { queued: jobRows.filter((j) => j.status === "queued").length, running: jobRows.filter((j) => j.status === "running").length, failed7d: count("failed"), published7d: count("succeeded") },
      lastError: (c?.sync_error as string | null) ?? (lastFailed ? String(lastFailed.last_error) : null),
      jobs: jobRows.slice(0, 15).map((j) => ({
        id: j.id,
        title: titles.get(j.draft_id as string) ?? "(deleted pin)",
        status: j.status,
        board_name: j.board_name,
        run_at: j.run_at,
        timezone: j.timezone ?? null,
        attempts: j.attempts,
        last_error: j.last_error,
        external_pin_id: j.external_pin_id,
      })),
    });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err, request, "Could not load the check.");
  }
}

const Test = z.object({ workspace: WorkspaceSlug, test: z.enum(["connection", "boards"]) });

/** Read-only API tests: they never create anything on Pinterest. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "pinterest");
  if (limited) return limited;
  const parsed = Test.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { api, repo, workspaceId } = await pinterestContext(parsed.data.workspace);
    const conn = await repo.get(workspaceId);
    if (!conn) return NextResponse.json({ ok: false, error: "Not connected to Pinterest yet." });
    const started = Date.now();
    const token = await repo.accessToken(api, conn);
    if (parsed.data.test === "connection") {
      const acc = await api.account(token);
      return NextResponse.json({ ok: true, ms: Date.now() - started, detail: `@${acc.username} (${acc.account_type ?? "account"})` });
    }
    const boards = await api.get<{ items: PinterestBoard[] }>(token, "/boards", { page_size: 5 });
    return NextResponse.json({ ok: true, ms: Date.now() - started, detail: `${boards.items.length} board(s) read: ${boards.items.map((b) => b.name).join(", ") || "none"}` });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: err instanceof PinterestApiError || err instanceof ReconnectRequired ? describePinterestError(err) : "The test failed on the server." });
  }
}
