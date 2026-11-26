import { rateLimited } from "@/lib/server/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PinterestApi } from "@/lib/pinterest/api";
import { checkPinterestConfig, getPinterestConfig } from "@/lib/pinterest/config";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { describePinterestError } from "@/lib/pinterest/sync";
import { getRequestContext, HttpError, workspaceIdFor } from "@/lib/server/context";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type PinDraft } from "@/lib/types";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { publishBlockers, validateRunAt } from "@/lib/workflow/checks";
import { runPublishJob } from "@/lib/workflow/runner";
import { audit, supabaseRunnerDeps } from "@/lib/workflow/server";
import { LIVE_ACTIONS, nextStatus, type WorkflowAction } from "@/lib/workflow/transitions";

const Body = z.object({
  workspace: WorkspaceSlug,
  draftId: z.string().uuid(),
  action: z.enum(["submit", "request_changes", "approve", "unapprove", "schedule", "cancel_schedule", "publish_now"]),
  boardId: z.string().max(64).optional(),
  boardName: z.string().max(200).optional(),
  runAt: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
  /** Live actions must be explicitly confirmed by the user in the UI. */
  confirm: z.boolean().optional(),
});

export async function POST(request: Request) {
  const limitedRes = rateLimited(request, "publish");
  if (limitedRes) return limitedRes;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  const action = b.action as WorkflowAction;

  try {
    const ctx = await getRequestContext();
    if (ctx.mode !== "supabase") throw new HttpError(503, "The approval workflow on the server needs Supabase.");
    const workspaceId = (await workspaceIdFor(ctx, b.workspace))!;

    // Read through the user's session: proves ownership.
    const { data: draft, error } = await ctx.db.from("pin_drafts").select("*").eq("id", b.draftId).eq("workspace_id", workspaceId).single();
    if (error || !draft) throw new HttpError(404, "Pin not found in this workspace");
    const d = draft as PinDraft;
    let to: string;
    try {
      to = nextStatus(d.status, action);
    } catch (e) {
      throw new HttpError(409, (e as Error).message);
    }
    if (LIVE_ACTIONS.includes(action) && b.confirm !== true) throw new HttpError(400, "Please confirm this action.");

    const admin = getAdminSupabase();
    const actor = ctx.user.id;
    const now = new Date().toISOString();
    const guarded = (patch: Record<string, unknown>) =>
      admin.from("pin_drafts").update(patch).eq("id", d.id).eq("workspace_id", workspaceId).eq("status", d.status).select("id");

    if (action === "submit" || action === "request_changes" || action === "approve" || action === "unapprove") {
      const patch: Record<string, unknown> = { status: to };
      if (action === "approve") Object.assign(patch, { approved_at: now, approved_by: actor, review_note: null });
      if (action === "unapprove" || action === "request_changes") Object.assign(patch, { approved_at: null, approved_by: null });
      if (action === "request_changes") patch.review_note = b.note ?? null;
      if (action === "submit") patch.review_note = null;
      const res = await guarded(patch);
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.length) throw new HttpError(409, "The pin changed in the meantime. Refresh and try again.");
      await audit(admin, { workspaceId, actorId: actor, action, draftId: d.id, details: { from: d.status, to, ...(b.note ? { note: b.note } : {}) } });
      return NextResponse.json({ ok: true, status: to });
    }

    if (action === "cancel_schedule") {
      const job = await admin.from("publish_jobs").update({ status: "cancelled", finished_at: now }).eq("draft_id", d.id).eq("status", "queued").select("id");
      if (job.error) throw new Error(job.error.message);
      if (!job.data?.length) throw new HttpError(409, "This pin is being published right now and can't be cancelled.");
      await guarded({ status: "approved", scheduled_for: null });
      await audit(admin, { workspaceId, actorId: actor, action, draftId: d.id, details: { job_id: job.data[0].id } });
      return NextResponse.json({ ok: true, status: "approved" });
    }

    // schedule / publish_now -------------------------------------------------
    const cfgCheck = checkPinterestConfig();
    if (!cfgCheck.ready) throw new HttpError(503, `Pinterest isn't configured. Missing: ${cfgCheck.missing.join(", ")}`);
    const cfg = getPinterestConfig();
    const repo = new ConnectionRepo(admin, cfg.encryptionKey);
    const info = await repo.info(workspaceId);
    const blockers = publishBlockers(d, {
      connected: Boolean(info),
      connectionActive: info?.status === "active",
      grantedScopes: info?.scopes ?? [],
      boardId: b.boardId ?? null,
    });
    if (blockers.length) return NextResponse.json({ error: blockers.join(" "), blockers }, { status: 422 });
    // Spec 11: the board must be one of this account's own synced boards. Its name comes from the sync, not the browser.
    const ownBoard = await admin.from("pinterest_boards").select("board_id, name").eq("workspace_id", workspaceId).eq("board_id", b.boardId!).maybeSingle();
    if (ownBoard.error) throw new Error(ownBoard.error.message);
    if (!ownBoard.data) throw new HttpError(422, "That board isn't on the connected Pinterest account. Sync boards and choose again.");
    b.boardName = ownBoard.data.name;

    let runAt = now;
    if (action === "schedule") {
      const problem = validateRunAt(b.runAt ?? "");
      if (problem) throw new HttpError(422, problem);
      runAt = new Date(b.runAt!).toISOString();
    }

    const job = await admin
      .from("publish_jobs")
      .insert({ workspace_id: workspaceId, draft_id: d.id, board_id: b.boardId, board_name: b.boardName ?? null, run_at: runAt, created_by: actor })
      .select("id")
      .single();
    if (job.error) {
      if (job.error.code === "23505") throw new HttpError(409, "This pin already has a publish job; it won't be published twice.");
      throw new Error(job.error.message);
    }
    const moved = await guarded({ status: "scheduled", scheduled_for: runAt, board_id: b.boardId, board_name: b.boardName ?? null });
    if (moved.error || !moved.data?.length) {
      await admin.from("publish_jobs").update({ status: "cancelled", finished_at: now }).eq("id", job.data.id);
      throw new HttpError(409, "The pin changed in the meantime. Refresh and try again.");
    }
    await audit(admin, {
      workspaceId, actorId: actor, action: action === "schedule" ? "scheduled" : "publish_requested", draftId: d.id,
      details: { job_id: job.data.id, board_id: b.boardId, board_name: b.boardName, run_at: runAt, environment: cfg.env },
    });

    if (action === "schedule") return NextResponse.json({ ok: true, status: "scheduled", run_at: runAt });

    const outcome = await runPublishJob(job.data.id, supabaseRunnerDeps(admin, new PinterestApi(cfg), repo));
    if (outcome.status === "succeeded") return NextResponse.json({ ok: true, status: "published", pin_id: outcome.pinId });
    if (outcome.status === "retrying") {
      return NextResponse.json({ ok: false, status: "scheduled", error: `Pinterest didn't accept it yet (${outcome.error}). It will retry automatically.` }, { status: 202 });
    }
    return NextResponse.json({ error: outcome.status === "failed" ? `Publishing failed: ${outcome.error}` : "Publishing is already in progress." }, { status: 502 });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("transition failed", err);
    return NextResponse.json({ error: describePinterestError(err) }, { status: 500 });
  }
}
