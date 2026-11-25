import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET } from "@/lib/ai/image/types";
import { PinterestApi, type PinterestPin } from "@/lib/pinterest/api";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { ensureAccessToken, ReconnectRequired } from "@/lib/pinterest/sync";
import type { DraftForPublish, PublishJob, RunnerDeps } from "./runner";

export async function audit(admin: SupabaseClient, e: { workspaceId: string; actorId: string | null; action: string; draftId: string; details?: Record<string, unknown> }) {
  const { error } = await admin.from("audit_events").insert({
    workspace_id: e.workspaceId,
    actor_id: e.actorId,
    action: e.action,
    target_type: "pin_draft",
    target_id: e.draftId,
    details: e.details ?? {},
  });
  if (error) console.error("audit insert failed", error.message);
}

/** Supabase-backed implementation of the runner's dependencies. */
export function supabaseRunnerDeps(admin: SupabaseClient, api: PinterestApi, repo: ConnectionRepo): RunnerDeps {
  return {
    async claim(jobId) {
      const { data, error } = await admin.rpc("claim_publish_job", { p_job: jobId });
      if (error) throw new Error(error.message);
      return ((data as PublishJob[] | null) ?? [])[0] ?? null;
    },
    async getDraft(job) {
      const { data, error } = await admin
        .from("pin_drafts")
        .select("title, description, alt_text, link, image_path, status, external_pin_id")
        .eq("id", job.draft_id)
        .eq("workspace_id", job.workspace_id)
        .single();
      if (error || !data) throw new Error("Draft not found");
      return data as DraftForPublish;
    },
    async getAccessToken(job) {
      const conn = await repo.get(job.workspace_id);
      if (!conn) throw new ReconnectRequired("This workspace is no longer connected to Pinterest.");
      return ensureAccessToken(api, conn, (t) => repo.updateTokens(job.workspace_id, t, conn.refresh_token));
    },
    async loadImage(path) {
      const { data, error } = await admin.storage.from(IMAGE_BUCKET).download(path);
      if (error || !data) throw new Error("Could not read the pin image from storage");
      const ext = path.split(".").pop()?.toLowerCase();
      return { base64: Buffer.from(await data.arrayBuffer()).toString("base64"), contentType: ext === "png" ? "image/png" : "image/jpeg" };
    },
    createPin: (token, body) => api.createPin(token, body),
    async recentBoardPins(token, boardId) {
      const res = await api.get<{ items: PinterestPin[] }>(token, `/boards/${encodeURIComponent(boardId)}/pins`, { page_size: 50 });
      return res.items;
    },
    async succeed(job, pinId, viaRecovery) {
      const now = new Date().toISOString();
      await admin.from("publish_jobs").update({ status: "succeeded", external_pin_id: pinId, finished_at: now, last_error: null }).eq("id", job.id);
      await admin
        .from("pin_drafts")
        .update({ status: "published", published_at: now, external_pin_id: pinId })
        .eq("id", job.draft_id)
        .eq("workspace_id", job.workspace_id);
      await audit(admin, { workspaceId: job.workspace_id, actorId: null, action: "published", draftId: job.draft_id, details: { pin_id: pinId, job_id: job.id, attempt: job.attempts, recovered: viaRecovery } });
    },
    async fail(job, error, opts) {
      const now = new Date().toISOString();
      if (opts.retry) {
        await admin
          .from("publish_jobs")
          .update({ status: "queued", run_at: opts.retryAt ?? now, last_error: error.slice(0, 500), uncertain: job.uncertain || opts.uncertain })
          .eq("id", job.id);
        await audit(admin, { workspaceId: job.workspace_id, actorId: null, action: "publish_retry_scheduled", draftId: job.draft_id, details: { error, attempt: job.attempts, retry_at: opts.retryAt } });
        return;
      }
      await admin.from("publish_jobs").update({ status: "failed", finished_at: now, last_error: error.slice(0, 500), uncertain: job.uncertain || opts.uncertain }).eq("id", job.id);
      // Return the draft to Approved so the user can fix and try again (a new job is allowed after a failure).
      await admin
        .from("pin_drafts")
        .update({ status: "approved", scheduled_for: null, review_note: `Publishing failed: ${error.slice(0, 300)}` })
        .eq("id", job.draft_id)
        .eq("workspace_id", job.workspace_id)
        .eq("status", "scheduled");
      await audit(admin, { workspaceId: job.workspace_id, actorId: null, action: "publish_failed", draftId: job.draft_id, details: { error, attempt: job.attempts, possibly_created: opts.uncertain } });
    },
  };
}
