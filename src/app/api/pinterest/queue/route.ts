import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { ADMIN_KEY_MISSING_MESSAGE, getAdminSupabase, hasAdminSupabase } from "@/lib/supabase/admin";
import { isMissingColumn } from "@/lib/supabase/compat";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { rateLimited } from "@/lib/server/rateLimit";

const Body = z.object({ workspace: WorkspaceSlug, paused: z.boolean() });

/** Pauses or resumes this account's publishing queue. Paused jobs stay queued and publish after resume. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "publish");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(503, "The publishing queue needs Supabase.");
    if (!hasAdminSupabase()) throw new HttpError(503, ADMIN_KEY_MISSING_MESSAGE);
    const workspaceId = (await workspaceIdFor(ctx, parsed.data.workspace))!; // ownership check (RLS)
    const admin = getAdminSupabase();
    const res = await admin.from("workspaces").update({ publishing_paused: parsed.data.paused }).eq("id", workspaceId);
    if (isMissingColumn(res.error)) throw new HttpError(503, "Run database update 0016_publishing_control.sql in Supabase first.");
    if (res.error) throw new Error(res.error.message);
    await admin.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_id: ctx.user.id,
      action: parsed.data.paused ? "queue_paused" : "queue_resumed",
      target_type: "workspace",
      target_id: workspaceId,
      details: {},
    });
    return NextResponse.json({ ok: true, paused: parsed.data.paused });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: err instanceof HttpError ? err.message : "Could not change the publishing queue." }, { status });
  }
}
