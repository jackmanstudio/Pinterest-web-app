import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTextProvider } from "@/lib/ai/text";
import { latestSnapshots } from "@/lib/analytics/server";
import type { AccountAnalytics, TrendKeyword } from "@/lib/analytics/types";
import { loadPinSamples, OwnerLedger } from "@/lib/autopilot/server";
import { assertWithinBudget } from "@/lib/usage/budget";
import { estimateTextCost } from "@/lib/usage/pricing";
import { isMissingColumn, isMissingTable } from "@/lib/supabase/compat";
import { MAX_PENDING, ruleGrowthIdeas, verifyGrowthIdeas, type GrowthInput } from "./growth";

export const NEEDS_AGENT_MIGRATION = "The growth agent needs a database update. Run supabase/migrations/0014_growth_agent.sql in the Supabase SQL editor.";

const DAY = 24 * 60 * 60 * 1000;

export interface AgentWorkspace {
  workspace_id: string;
  owner_id: string;
  slug: string;
}

export interface GrowthRunResult {
  status: "ok" | "skipped" | "failed";
  kept: number;
  dropped: number;
  provider: string;
  detail: string | null;
}

async function recentIdeas(admin: SupabaseClient, workspaceId: string): Promise<string[]> {
  const since = new Date(Date.now() - 60 * DAY).toISOString();
  const [ideas, sugg] = await Promise.all([
    admin.from("autopilot_ideas").select("idea").eq("workspace_id", workspaceId).gte("created_at", since).order("created_at", { ascending: false }).limit(100),
    admin.from("agent_suggestions").select("idea").eq("workspace_id", workspaceId).gte("created_at", since).order("created_at", { ascending: false }).limit(100),
  ]);
  return [...(ideas.data ?? []), ...(sugg.data ?? [])].map((r) => r.idea as string);
}

async function brandFor(admin: SupabaseClient, workspaceId: string): Promise<GrowthInput["brand"]> {
  let res = await admin.from("brand_settings").select("brand_name, audience, focus_keywords, banned_words, language").eq("workspace_id", workspaceId).maybeSingle();
  if (isMissingColumn(res.error)) res = await admin.from("brand_settings").select("brand_name, audience, focus_keywords, banned_words").eq("workspace_id", workspaceId).maybeSingle();
  const b = (res.data ?? {}) as Record<string, unknown>;
  return {
    brand_name: (b.brand_name as string) || null,
    audience: (b.audience as string) || null,
    focus_keywords: (b.focus_keywords as string[]) ?? [],
    banned_words: (b.banned_words as string[]) ?? [],
    language: (b.language as string) || null,
  };
}

/**
 * One growth-agent run for one account. Reads only stored data, writes
 * suggestions (never pins, never the Autopilot queue) and a run record.
 */
export async function runGrowthAgent(
  admin: SupabaseClient,
  ws: AgentWorkspace,
  trigger: "manual" | "schedule",
  env: Record<string, string | undefined> = process.env,
): Promise<GrowthRunResult> {
  const provider = getTextProvider(env);
  const useAi = provider.source === "ai" && typeof provider.generateGrowthIdeas === "function";
  const providerName = useAi ? provider.name : "Rules (no text AI)";

  const record = async (r: GrowthRunResult, extra: { model?: string | null; snapshot_ids?: string[] } = {}) => {
    const { data, error } = await admin
      .from("agent_runs")
      .insert({ workspace_id: ws.workspace_id, trigger, status: r.status, provider: r.provider, model: extra.model ?? null, snapshot_ids: extra.snapshot_ids ?? [], kept: r.kept, dropped: r.dropped, detail: r.detail?.slice(0, 500) ?? null })
      .select("id")
      .single();
    if (error) throw new Error(isMissingTable(error) ? NEEDS_AGENT_MIGRATION : error.message);
    return data.id as string;
  };

  const settings = await admin.from("agent_settings").select("ideas_per_run").eq("workspace_id", ws.workspace_id).maybeSingle();
  if (isMissingTable(settings.error)) throw new Error(NEEDS_AGENT_MIGRATION);
  const want = Math.min(6, Math.max(1, (settings.data?.ideas_per_run as number | undefined) ?? 5));

  const pending = await admin.from("agent_suggestions").select("id", { count: "exact", head: true }).eq("workspace_id", ws.workspace_id).eq("status", "suggested");
  if ((pending.count ?? 0) >= MAX_PENDING) {
    const r: GrowthRunResult = { status: "skipped", kept: 0, dropped: 0, provider: providerName, detail: `${pending.count} ideas are still waiting. Accept or dismiss some first.` };
    await record(r);
    return r;
  }

  const snaps = await latestSnapshots(admin, ws.workspace_id);
  const { winners } = await loadPinSamples(admin, ws.workspace_id);
  const account = (snaps.account?.data as AccountAnalytics | undefined)?.summary ?? null;
  const trends = ((snaps.trends?.data as TrendKeyword[] | undefined) ?? []).slice(0, 40);
  const pins = winners
    .filter((w) => w.title?.trim())
    .sort((a, b) => b.saves * 3 + b.outbound * 3 + b.clicks - (a.saves * 3 + a.outbound * 3 + a.clicks))
    .slice(0, 25);
  if (!account && !pins.length && !trends.length) {
    const r: GrowthRunResult = { status: "skipped", kept: 0, dropped: 0, provider: providerName, detail: "No Pinterest data yet. Connect Pinterest and refresh Analytics first." };
    await record(r);
    return r;
  }

  const input: GrowthInput = { workspace: ws.slug, brand: await brandFor(admin, ws.workspace_id), account, pins, trends, recent: await recentIdeas(admin, ws.workspace_id), want };
  const snapshot_ids = Object.values(snaps).map((s) => s!.id);

  let ideas = ruleGrowthIdeas(input);
  let model: string | null = null;
  if (useAi) {
    const ledger = new OwnerLedger(admin, ws.owner_id);
    try {
      await assertWithinBudget(ledger, true, env);
      const out = await provider.generateGrowthIdeas!(input);
      ideas = out.ideas;
      model = out.model;
      await ledger.record({
        workspace_id: ws.workspace_id, kind: "text", provider: provider.name, model: out.model, source: "ai",
        input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, images: 0,
        est_cost_usd: estimateTextCost(out.model, out.usage.input_tokens, out.usage.output_tokens), status: "ok", error: null,
      });
    } catch (err) {
      const r: GrowthRunResult = { status: "failed", kept: 0, dropped: 0, provider: providerName, detail: (err as Error).message };
      await record(r, { snapshot_ids });
      return r;
    }
  }

  const { kept, dropped } = verifyGrowthIdeas(ideas, input);
  const r: GrowthRunResult = {
    status: "ok", kept: kept.length, dropped: dropped.length, provider: providerName,
    detail: kept.length ? null : "No new ideas passed the checks this time (repeats or unverifiable numbers are dropped).",
  };
  const runId = await record(r, { model, snapshot_ids });
  if (kept.length) {
    const { error } = await admin.from("agent_suggestions").insert(
      kept.map((k) => ({ workspace_id: ws.workspace_id, run_id: runId, idea: k.idea, reason: k.reason || null, evidence: k.evidence || null, signal: k.signal, ref: k.ref })),
    );
    if (error) throw new Error(error.message);
  }
  return r;
}

/** Accounts with the daily growth agent on whose last run was over ~a day ago. */
export async function dueGrowthWorkspaces(admin: SupabaseClient): Promise<AgentWorkspace[]> {
  type WsJoin = { owner_id: string; kind: string; slug?: string };
  const run = (cols: string) =>
    admin.from("agent_settings").select(`workspace_id, workspaces!inner(${cols})`).eq("growth_enabled", true).returns<{ workspace_id: string; workspaces: WsJoin | WsJoin[] }[]>();
  let res = await run("owner_id, kind, slug");
  if (isMissingColumn(res.error)) res = await run("owner_id, kind");
  if (isMissingTable(res.error)) return [];
  if (res.error) throw new Error(res.error.message);
  const out: AgentWorkspace[] = [];
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  for (const r of res.data ?? []) {
    const last = await admin.from("agent_runs").select("id").eq("workspace_id", r.workspace_id).eq("trigger", "schedule").gte("created_at", cutoff).limit(1);
    if (last.data?.length) continue;
    const w = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces;
    out.push({ workspace_id: r.workspace_id, owner_id: w.owner_id, slug: w.slug ?? w.kind });
  }
  return out;
}

/** Moves an accepted suggestion into the Autopilot queue as an agent idea. */
export async function acceptSuggestion(admin: SupabaseClient, workspaceId: string, id: string): Promise<string> {
  const { data: s, error } = await admin.from("agent_suggestions").select("id, idea, ref, status").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!s) throw new Error("Suggestion not found");
  if (s.status !== "suggested") throw new Error("This idea was already handled.");
  // Claim first so a double click can't queue it twice.
  const claim = await admin.from("agent_suggestions").update({ status: "accepted", decided_at: new Date().toISOString() }).eq("id", id).eq("status", "suggested").select("id");
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data?.length) throw new Error("This idea was already handled.");
  const ins = await admin.from("autopilot_ideas").insert({ workspace_id: workspaceId, idea: s.idea, source: "agent", ref: s.ref }).select("id").single();
  if (ins.error) {
    await admin.from("agent_suggestions").update({ status: "suggested", decided_at: null }).eq("id", id);
    throw new Error(ins.error.message);
  }
  await admin.from("agent_suggestions").update({ idea_id: ins.data.id }).eq("id", id);
  return ins.data.id as string;
}
