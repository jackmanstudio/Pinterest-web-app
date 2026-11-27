import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { log } from "./log";
import { buildReport, type ErrorReport, type ErrorSource } from "./errorInfo";

export { newErrorId } from "./errorInfo";

export interface ReportInfo {
  source?: ErrorSource;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  digest?: string | null;
  context?: Record<string, unknown>;
  /** Signed-in user, when the caller already knows it (saves a lookup). */
  userId?: string | null;
}

async function store(report: ErrorReport, userId: string | null | undefined) {
  if (!isSupabaseConfigured) return;
  let db: SupabaseClient;
  let uid = userId ?? null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    db = getAdminSupabase();
    if (!uid) uid = await getServerSupabase().then((s) => s.auth.getUser()).then((r) => r.data.user?.id ?? null).catch(() => null);
  } else {
    // Without the service key, rows are written as the signed-in user (RLS: own rows only).
    db = await getServerSupabase();
    if (!uid) uid = (await db.auth.getUser()).data.user?.id ?? null;
    if (!uid) return;
  }
  const { where, ...row } = report;
  const { error } = await db.from("error_events").insert({ ...row, context: { ...row.context, ...(where ? { where } : {}) }, user_id: uid });
  if (error) log("warn", "error_store_failed", { errorId: report.id, message: error.message, code: error.code });
}

/**
 * Records an unexpected error: one structured log line (Vercel logs) plus a row
 * in error_events when the database is set up. Never throws. Returns the error ID
 * to show the user, so the exact failure can be found later.
 */
export async function reportError(err: unknown, info: ReportInfo = {}): Promise<string> {
  const report = buildReport(err, info);
  log("error", "app_error", { errorId: report.id, source: report.source, route: report.route, method: report.method, status: report.status, message: report.message, where: report.where, digest: report.digest, context: report.context });
  try {
    await Promise.race([store(report, info.userId), new Promise((r) => setTimeout(r, 2500))]);
  } catch (e) {
    log("warn", "error_store_failed", { errorId: report.id, message: e instanceof Error ? e.message : String(e) });
  }
  return report.id;
}

/** Reports the error and returns the 500 JSON response with the error ID in it. */
export async function errorResponse(err: unknown, request: Request | null, userMessage: string, extra: Record<string, unknown> = {}, status = 500) {
  const route = request ? new URL(request.url).pathname : null;
  const errorId = await reportError(err, { source: "api", route, method: request?.method ?? null, status, context: extra });
  return NextResponse.json({ error: `${userMessage} (Error ID: ${errorId})`, errorId, retryable: true }, { status, headers: { "x-error-id": errorId } });
}
