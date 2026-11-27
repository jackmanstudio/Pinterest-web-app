import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { reportError } from "@/lib/server/errors";
import { isMissingTable } from "@/lib/supabase/compat";
import { log } from "@/lib/server/log";

const Body = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(500).optional(),
  digest: z.string().max(200).optional(),
  kind: z.enum(["error", "unhandledrejection", "render", "fetch"]).default("error"),
  status: z.number().int().min(0).max(999).optional(),
  api: z.string().max(300).optional(),
  errorId: z.string().max(40).optional(),
});

const NEEDS_TABLE = "The error log needs a database update. Run supabase/migrations/0015_error_events.sql in the Supabase SQL editor.";

/** Browser crashes and failed API calls are sent here, so they land in the same error log as server errors. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "errors");
  if (limited) return limited;
  const raw = await request.text().catch(() => "");
  if (raw.length > 12_000) return NextResponse.json({ error: "Report too large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid error report" }, { status: 400 });
  const b = parsed.data;
  let userId: string | null = null;
  try {
    const ctx = await getRequestContext();
    if (ctx.mode === "supabase") userId = ctx.user.id;
  } catch {}
  const err = Object.assign(new Error(b.message), { stack: b.stack ?? `Error: ${b.message}` });
  const errorId = await reportError(err, {
    source: "client",
    route: b.route ?? null,
    method: null,
    status: b.status ?? null,
    digest: b.digest ?? null,
    userId,
    context: { kind: b.kind, api: b.api, serverErrorId: b.errorId, userAgent: request.headers.get("user-agent")?.slice(0, 200) },
  });
  return NextResponse.json({ ok: true, errorId });
}

/** The signed-in user's latest 50 errors (server and browser), newest first. */
export async function GET() {
  await connection();
  try {
    const ctx = await getRequestContext();
    if (ctx.mode === "demo") return NextResponse.json({ errors: [], note: "Demo mode keeps errors in the server log only." });
    const { data, error } = await ctx.db
      .from("error_events")
      .select("id, created_at, source, route, method, status, message, digest, context")
      .order("created_at", { ascending: false })
      .limit(50);
    if (isMissingTable(error)) return NextResponse.json({ errors: [], note: NEEDS_TABLE });
    if (error) throw new Error(error.message);
    return NextResponse.json({ errors: data ?? [] });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    log("error", "errors_list_failed", { message: (err as Error).message });
    return NextResponse.json({ error: "Could not load the error log" }, { status: 500 });
  }
}
