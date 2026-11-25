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
import { brandArtFor, brandPinImage } from "@/lib/brand/server";
import { buildImagePrompt } from "@/lib/ai/image/prompt";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import type { UsageEntry, UsageLedger } from "@/lib/usage/ledger";
import { estimateTextCost, startOfMonthUtc } from "@/lib/usage/pricing";
import { publishBlockers, PUBLISH_SCOPES } from "@/lib/workflow/checks";
import { runPublishJob } from "@/lib/workflow/runner";
import { audit, supabaseRunnerDeps } from "@/lib/workflow/server";
import type { AutopilotDeps, AutopilotWorkspace, Idea } from "./engine";
import { bestPostingHours, type PinSample } from "./bestTime";
import { pickTrend, pickWinner, trendIdea, winnerIdea, type WinnerCandidate } from "./sources";
import { analyticsCalls, saveSnapshot } from "@/lib/analytics/server";
import { parseTopPins, parseTrends } from "@/lib/analytics/parse";
import type { PublishedPinStats, TopPin, TrendKeyword } from "@/lib/analytics/types";
import { ensureAccessToken } from "@/lib/pinterest/sync";

const DAY = 86_400_000;

async function latest<T>(db: SupabaseClient, workspaceId: string, kind: string): Promise<{ data: T; fetched_at: string } | null> {
  const { data } = await db
    .from("analytics_snapshots")
    .select("data, fetched_at")
    .eq("workspace_id", workspaceId)
    .eq("kind", kind)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { data: T; fetched_at: string } | null) ?? null;
}

/** Your pins with their post time and stats, from the latest stored analytics. Works with RLS or admin clients. */
export async function loadPinSamples(db: SupabaseClient, workspaceId: string): Promise<{ samples: PinSample[]; winners: WinnerCandidate[] }> {
  const [top, published] = await Promise.all([
    latest<TopPin[]>(db, workspaceId, "top_pins"),
    latest<PublishedPinStats[]>(db, workspaceId, "published_pins"),
  ]);
  const byId = new Map<string, { created_at: string | null; title: string | null; m: Record<string, number> }>();
  const topIds = (top?.data ?? []).map((p) => p.pin_id);
  if (topIds.length) {
    const { data } = await db.from("pinterest_pins").select("pin_id, title, pin_created_at").eq("workspace_id", workspaceId).in("pin_id", topIds);
    const meta = new Map((data ?? []).map((r) => [r.pin_id as string, r]));
    for (const p of top!.data) byId.set(p.pin_id, { created_at: meta.get(p.pin_id)?.pin_created_at ?? null, title: meta.get(p.pin_id)?.title ?? null, m: p.metrics });
  }
  const pub = (published?.data ?? []).filter((p) => !p.error);
  if (pub.length) {
    const { data } = await db.from("pin_drafts").select("id, published_at").eq("workspace_id", workspaceId).in("id", pub.map((p) => p.draft_id));
    const when = new Map((data ?? []).map((r) => [r.id as string, r.published_at as string | null]));
    for (const p of pub) if (!byId.has(p.pin_id)) byId.set(p.pin_id, { created_at: when.get(p.draft_id) ?? null, title: p.title, m: p.summary });
  }
  const samples: PinSample[] = [];
  const winners: WinnerCandidate[] = [];
  for (const [pin_id, v] of byId) {
    const saves = v.m.SAVE ?? 0, clicks = v.m.PIN_CLICK ?? 0, outbound = v.m.OUTBOUND_CLICK ?? 0, impressions = v.m.IMPRESSION ?? 0;
    if (v.created_at) samples.push({ created_at: v.created_at, saves, clicks, outbound, impressions });
    winners.push({ pin_id, title: v.title, saves, clicks, outbound });
  }
  return { samples, winners };
}

async function usedRefs(admin: SupabaseClient, workspaceId: string, source: string, days: number): Promise<{ refs: Set<string>; lastAt: number | null }> {
  const { data } = await admin
    .from("autopilot_ideas")
    .select("ref, created_at")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .gte("created_at", new Date(Date.now() - days * DAY).toISOString())
    .order("created_at", { ascending: false });
  return { refs: new Set((data ?? []).map((r) => String(r.ref ?? "").toLowerCase()).filter(Boolean)), lastAt: data?.[0] ? Date.parse(data[0].created_at) : null };
}

async function insertAutoIdea(admin: SupabaseClient, workspaceId: string, idea: string, source: "agent" | "trends", ref: string): Promise<Idea | null> {
  const { data, error } = await admin.from("autopilot_ideas").insert({ workspace_id: workspaceId, idea, source, ref, status: "processing" }).select("id, idea").single();
  if (error) throw new Error(error.message);
  return data as Idea;
}

/** Fresh-enough trends: the latest stored snapshot, or a new fetch from Pinterest if it's over 3 days old. */
async function trendsFor(admin: SupabaseClient, ws: AutopilotWorkspace): Promise<TrendKeyword[]> {
  const snap = await latest<TrendKeyword[]>(admin, ws.workspace_id, "trends");
  if (snap && Date.now() - Date.parse(snap.fetched_at) < 3 * DAY) return snap.data;
  try {
    const cfg = getPinterestConfig();
    const api = new PinterestApi(cfg);
    const repo = new ConnectionRepo(admin, cfg.encryptionKey);
    const conn = await repo.get(ws.workspace_id);
    if (!conn) return snap?.data ?? [];
    const token = await ensureAccessToken(api, conn, (t) => repo.updateTokens(ws.workspace_id, t, conn.refresh_token));
    const trends = parseTrends(await analyticsCalls(api).trends(token, "US", "growing", ws.trend_interest ?? undefined));
    await saveSnapshot(admin, {
      workspaceId: ws.workspace_id, kind: "trends", source: "Pinterest API v5 · GET /trends/keywords/{region}/top/{trend_type}", environment: cfg.env,
      end: new Date().toISOString().slice(0, 10), params: { region: "US", type: "growing", interest: ws.trend_interest, by: "autopilot" }, data: trends,
    });
    return trends;
  } catch {
    return snap?.data ?? [];
  }
}

/** Keeps top-pin stats fresh (weekly) so winners and best times keep learning. */
async function refreshTopPins(admin: SupabaseClient, ws: AutopilotWorkspace) {
  const snap = await latest<TopPin[]>(admin, ws.workspace_id, "top_pins");
  if (snap && Date.now() - Date.parse(snap.fetched_at) < 7 * DAY) return;
  try {
    const cfg = getPinterestConfig();
    const api = new PinterestApi(cfg);
    const repo = new ConnectionRepo(admin, cfg.encryptionKey);
    const conn = await repo.get(ws.workspace_id);
    if (!conn) return;
    const token = await ensureAccessToken(api, conn, (t) => repo.updateTokens(ws.workspace_id, t, conn.refresh_token));
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 89 * DAY).toISOString().slice(0, 10);
    const raw = await analyticsCalls(api).topPins(token, start, end);
    await saveSnapshot(admin, { workspaceId: ws.workspace_id, kind: "top_pins", source: "Pinterest API v5 · GET /user_account/analytics/top_pins (sorted by saves)", environment: cfg.env, start, end, data: parseTopPins(raw) });
  } catch {
    /* analytics are optional for Autopilot */
  }
}

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
  if (getImageProvider(env).source !== "ai") out.push("Add image AI: free CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, or a paid FAL_KEY (recommended) or OpenAI key.");
  const pc = checkPinterestConfig(env);
  if (!pc.ready) out.push(`Pinterest isn't configured on the server (missing ${pc.missing.join(", ")}).`);
  if (env.PINTEREST_ENABLE_PUBLISHING !== "true") out.push("Set PINTEREST_ENABLE_PUBLISHING=true.");
  if (!env.CRON_SECRET) out.push("Set CRON_SECRET and a scheduler that calls /api/cron/autopilot every hour.");
  return out;
}

export function supabaseAutopilotDeps(admin: SupabaseClient): AutopilotDeps {
  return {
    now: () => new Date(),

    async postingHours(ws) {
      await refreshTopPins(admin, ws);
      const { samples } = await loadPinSamples(admin, ws.workspace_id);
      return bestPostingHours(samples, ws.timezone).hours;
    },

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
      // Your queue first; then (if switched on) a new version of a winning pin at most weekly; then a fresh trend.
      async next(ws) {
        const { data, error } = await admin.rpc("claim_autopilot_idea", { p_workspace: ws.workspace_id });
        if (error) throw new Error(error.message);
        const row = (data as Idea[] | null)?.[0];
        if (row) return { id: row.id, idea: row.idea };

        if (ws.remix_winners) {
          const used = await usedRefs(admin, ws.workspace_id, "agent", 60);
          if (!used.lastAt || Date.now() - used.lastAt > 7 * DAY) {
            await refreshTopPins(admin, ws);
            const { winners } = await loadPinSamples(admin, ws.workspace_id);
            const w = pickWinner(winners, used.refs);
            if (w?.title) return insertAutoIdea(admin, ws.workspace_id, winnerIdea(w.title), "agent", w.pin_id);
          }
        }
        if (ws.auto_trends) {
          const used = await usedRefs(admin, ws.workspace_id, "trends", 30);
          const brand = await admin.from("brand_settings").select("focus_keywords").eq("workspace_id", ws.workspace_id).maybeSingle();
          const t = pickTrend(await trendsFor(admin, ws), used.refs, (brand.data?.focus_keywords as string[] | undefined) ?? [], !ws.trend_interest);
          if (t) return insertAutoIdea(admin, ws.workspace_id, trendIdea(t.keyword), "trends", t.keyword.toLowerCase());
        }
        return null;
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
        .select("id, title, angle, image_prompt");
      if (ins.error) throw new Error(ins.error.message);
      const art = await brandArtFor(admin, ws.workspace_id);

      let made = 0;
      for (const d of ins.data ?? []) {
        try {
          await assertWithinBudget(ledger, true);
          const prompt = buildImagePrompt({ title: d.title, scene: d.image_prompt, kind: ws.kind, overlay: art.template.style, angle: d.angle });
          const img = await brandPinImage(await withRetry(() => images.generate(prompt, PIN_IMAGE_SIZE)), d.title, art);
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
    .select("workspace_id, board_id, board_name, pins_per_day, link, timezone, best_time, remix_winners, auto_trends, trend_interest, workspaces!inner(owner_id, kind)")
    .eq("enabled", true);
  if (workspaceId) q = q.eq("workspace_id", workspaceId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const w = (Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces) as { owner_id: string; kind: AutopilotWorkspace["kind"] };
    return {
      workspace_id: r.workspace_id, owner_id: w.owner_id, kind: w.kind, board_id: r.board_id!, board_name: r.board_name, pins_per_day: r.pins_per_day, link: r.link,
      timezone: r.timezone, best_time: r.best_time, remix_winners: r.remix_winners, auto_trends: r.auto_trends, trend_interest: r.trend_interest,
    };
  });
}
