import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getImageProvider } from "@/lib/ai/image";
import { IMAGE_BUCKET, PIN_IMAGE_SIZE } from "@/lib/ai/image/types";
import { withRetry } from "@/lib/ai/retry";
import { getTextProvider } from "@/lib/ai/text";
import { PinterestApi } from "@/lib/pinterest/api";
import { checkPinterestConfig, getPinterestConfig } from "@/lib/pinterest/config";
import { ConnectionRepo } from "@/lib/pinterest/connections";
import { describePinterestError } from "@/lib/pinterest/sync";
import { EMPTY_BRAND, type BrandSettings } from "@/lib/types";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import type { UsageEntry, UsageLedger } from "@/lib/usage/ledger";
import { estimateTextCost, startOfMonthUtc } from "@/lib/usage/pricing";
import { publishBlockers, PUBLISH_SCOPES } from "@/lib/workflow/checks";
import { runPublishJob } from "@/lib/workflow/runner";
import { audit, supabaseRunnerDeps } from "@/lib/workflow/server";
import type { AutopilotDeps, AutopilotWorkspace, Idea } from "./engine";

/** Usage ledger for one owner, written with the service role (no user session in cron). */
export class OwnerLedger implements UsageLedger {
  readonly mode = "supabase" as const;
  constructor(private readonly admin: SupabaseClient, private readonly ownerId: string) {}
  async monthSpendUsd() {
    const { data, error } = await this.admin.from("ai_usage").select("est_cost_usd").eq("owner_id", this.ownerId).gte("created_at", startOfMonthUtc().toISOString());
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((s, r) => s + Number(r.est_cost_usd), 0);
  }
  async record(e: UsageEntry) {
    const { error } = await this.admin.from("ai_usage").insert({
      owner_id: this.ownerId, workspace_id: e.workspace_id, kind: e.kind, provider: e.provider, model: e.model, source: e.source,
      input_tokens: e.input_tokens, output_tokens: e.output_tokens, images: e.images, est_cost_usd: e.est_cost_usd, status: e.status, error: e.error?.slice(0, 500) ?? null,
    });
    if (error) throw new Error(error.message);
  }
  async recent() {
    return [];
  }
}

/** Static readiness checks that don't need a database (shown in the UI too). */
export function serverReadiness(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  if (getTextProvider(env).source !== "ai") out.push("Add TEXT_AI_API_KEY so pins are written by AI.");
  if (getImageProvider(env).source !== "ai") out.push("Add image AI: free CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, or a paid OpenAI key in IMAGE_AI_API_KEY.");
  const pc = checkPinterestConfig(env);
  if (!pc.ready) out.push(`Pinterest isn't configured on the server (missing ${pc.missing.join(", ")}).`);
  if (env.PINTEREST_ENABLE_PUBLISHING !== "true") out.push("Set PINTEREST_ENABLE_PUBLISHING=true.");
  if (!env.CRON_SECRET) out.push("Set CRON_SECRET and a scheduler that calls /api/cron/autopilot every hour.");
  return out;
}

export function supabaseAutopilotDeps(admin: SupabaseClient): AutopilotDeps {
  return {
    now: () => new Date(),

    async readinessProblems(ws) {
      const out = serverReadiness().filter((p) => !p.startsWith("Set CRON_SECRET"));
      if (out.length) return out;
      const repo = new ConnectionRepo(admin, getPinterestConfig().encryptionKey);
      const info = await repo.info(ws.workspace_id);
      if (!info) return ["Connect Pinterest to this workspace."];
      if (info.status !== "active") return ["Reconnect Pinterest (the saved login stopped working)."];
      const missing = PUBLISH_SCOPES.filter((s) => !info.scopes.includes(s));
      if (missing.length) return [`Reconnect Pinterest to grant publishing permission (${missing.join(", ")}).`];
      return [];
    },

    async recentPublishes(ws, since) {
      // Jobs with no human creator are Autopilot's. Failed attempts count too, so failures can't cause a burst.
      const { data, error } = await admin
        .from("publish_jobs")
        .select("created_at")
        .eq("workspace_id", ws.workspace_id)
        .is("created_by", null)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return { count: data?.length ?? 0, lastAt: data?.[0] ? new Date(data[0].created_at) : null };
    },

    async nextReadyDraft(ws) {
      const { data, error } = await admin
        .from("pin_drafts")
        .select("id")
        .eq("workspace_id", ws.workspace_id)
        .eq("autopilot", true)
        .eq("status", "approved")
        .eq("image_status", "ready")
        .eq("image_source", "ai")
        .is("external_pin_id", null)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    ideas: {
      async next(ws) {
        const { data, error } = await admin.rpc("claim_autopilot_idea", { p_workspace: ws.workspace_id });
        if (error) throw new Error(error.message);
        const row = (data as Idea[] | null)?.[0];
        return row ? { id: row.id, idea: row.idea } : null;
      },
      async finish(idea, r) {
        await admin
          .from("autopilot_ideas")
          .update({ status: r.status, error: r.error?.slice(0, 500) ?? null, processed_at: r.status === "queued" ? null : new Date().toISOString() })
          .eq("id", idea.id);
      },
    },

    async createPins(ws, idea) {
      const ledger = new OwnerLedger(admin, ws.owner_id);
      const text = getTextProvider();
      const images = getImageProvider();
      const brandRes = await admin.from("brand_settings").select("brand_name, voice, audience, website_url, focus_keywords, banned_words").eq("workspace_id", ws.workspace_id).maybeSingle();
      const brand = (brandRes.data as BrandSettings | null) ?? { ...EMPTY_BRAND };

      await assertWithinBudget(ledger, true);
      const result = await withRetry(() => text.generateDrafts({ workspace: ws.kind, idea: idea.idea, brand }));
      const cost = estimateTextCost(result.model, result.usage?.input_tokens ?? 0, result.usage?.output_tokens ?? 0);
      await ledger.record({ workspace_id: ws.workspace_id, kind: "text", provider: result.provider, model: result.model, source: result.source, input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0, images: 0, est_cost_usd: cost, status: "ok", error: null });

      const now = new Date().toISOString();
      const batchId = crypto.randomUUID();
      const ins = await admin
        .from("pin_drafts")
        .insert(
          result.drafts.map((d) => ({
            workspace_id: ws.workspace_id, batch_id: batchId, idea: idea.idea, angle: d.angle, concept: d.concept, title: d.title, description: d.description,
            tags: d.tags, alt_text: d.alt_text, image_prompt: d.image_prompt, source: result.source, link: ws.link ?? (brand.website_url || null),
            autopilot: true, status: "approved", approved_at: now, approved_by: ws.owner_id, review_note: "Auto-approved by Autopilot",
          })),
        )
        .select("id, image_prompt");
      if (ins.error) throw new Error(ins.error.message);

      let made = 0;
      for (const d of ins.data ?? []) {
        try {
          await assertWithinBudget(ledger, true);
          const img = await withRetry(() => images.generate(d.image_prompt, PIN_IMAGE_SIZE));
          const path = `${ws.workspace_id}/${d.id}-${Date.now()}.${img.extension}`;
          const up = await admin.storage.from(IMAGE_BUCKET).upload(path, img.bytes, { contentType: img.contentType, upsert: false });
          if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
          await admin.from("pin_drafts").update({ image_status: "ready", image_path: path, image_source: img.source }).eq("id", d.id);
          await ledger.record({ workspace_id: ws.workspace_id, kind: "image", provider: img.provider, model: img.model, source: img.source, input_tokens: 0, output_tokens: 0, images: 1, est_cost_usd: img.est_cost_usd, status: "ok", error: null });
          made++;
        } catch (err) {
          await admin.from("pin_drafts").update({ image_status: "failed" }).eq("id", d.id);
          if (err instanceof BudgetExceededError) {
            if (made === 0) throw err;
            break;
          }
          await ledger.record({ workspace_id: ws.workspace_id, kind: "image", provider: images.name, model: null, source: images.source, input_tokens: 0, output_tokens: 0, images: 0, est_cost_usd: 0, status: "error", error: (err as Error).message }).catch(() => {});
        }
      }
      return made;
    },

    async publish(ws, draftId) {
      const cfg = getPinterestConfig();
      const repo = new ConnectionRepo(admin, cfg.encryptionKey);
      const { data: d, error } = await admin.from("pin_drafts").select("*").eq("id", draftId).eq("workspace_id", ws.workspace_id).single();
      if (error || !d) return { ok: false, error: "Pin not found" };
      const info = await repo.info(ws.workspace_id);
      const blockers = publishBlockers(d, { connected: Boolean(info), connectionActive: info?.status === "active", grantedScopes: info?.scopes ?? [], boardId: ws.board_id });
      if (blockers.length) {
        // Park the pin so it isn't retried forever.
        await admin.from("pin_drafts").update({ status: "draft", approved_at: null, approved_by: null, review_note: `Autopilot skipped: ${blockers.join(" ")}` }).eq("id", draftId);
        return { ok: false, error: blockers.join(" ") };
      }
      const now = new Date().toISOString();
      const job = await admin
        .from("publish_jobs")
        .insert({ workspace_id: ws.workspace_id, draft_id: draftId, board_id: ws.board_id, board_name: ws.board_name, run_at: now, created_by: null })
        .select("id")
        .single();
      if (job.error) return { ok: false, error: job.error.code === "23505" ? "This pin already has a publish job." : job.error.message };
      await admin.from("pin_drafts").update({ status: "scheduled", scheduled_for: now, board_id: ws.board_id, board_name: ws.board_name }).eq("id", draftId).eq("status", "approved");
      await audit(admin, { workspaceId: ws.workspace_id, actorId: null, action: "autopilot_publish", draftId, details: { job_id: job.data.id, board_id: ws.board_id, environment: cfg.env } });
      try {
        const out = await runPublishJob(job.data.id, supabaseRunnerDeps(admin, new PinterestApi(cfg), repo));
        if (out.status === "succeeded") return { ok: true, pinId: out.pinId };
        if (out.status === "retrying") return { ok: true };
        return { ok: false, error: out.status === "failed" ? out.error : "Already in progress" };
      } catch (err) {
        return { ok: false, error: describePinterestError(err) };
      }
    },

    async setState(ws, state) {
      await admin.from("autopilot_settings").update({ paused_reason: state.paused_reason, last_run_at: new Date().toISOString() }).eq("workspace_id", ws.workspace_id);
    },

    isBudgetError: (err) => err instanceof BudgetExceededError,
  };
}

/** Loads every workspace with Autopilot switched on. */
export async function enabledWorkspaces(admin: SupabaseClient, workspaceId?: string): Promise<AutopilotWorkspace[]> {
  let q = admin
    .from("autopilot_settings")
    .select("workspace_id, board_id, board_name, pins_per_day, link, workspaces!inner(owner_id, kind)")
    .eq("enabled", true);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const w = (Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces) as { owner_id: string; kind: AutopilotWorkspace["kind"] };
    return { workspace_id: r.workspace_id, owner_id: w.owner_id, kind: w.kind, board_id: r.board_id!, board_name: r.board_name, pins_per_day: r.pins_per_day, link: r.link };
  });
}
