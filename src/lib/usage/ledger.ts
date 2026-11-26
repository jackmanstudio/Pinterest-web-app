import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentSource } from "@/lib/types";
import { startOfMonthUtc } from "./pricing";
import { isMissingColumn } from "@/lib/supabase/compat";

export interface UsageEntry {
  workspace_id: string | null;
  workspace_kind?: string;
  kind: "text" | "image";
  provider: string;
  model: string | null;
  source: ContentSource;
  input_tokens: number;
  output_tokens: number;
  images: number;
  est_cost_usd: number;
  status: "ok" | "error";
  error: string | null;
  created_at?: string;
}

export interface UsageLedger {
  readonly mode: "supabase" | "memory" | "browser";
  monthSpendUsd(): Promise<number>;
  record(entry: UsageEntry): Promise<void>;
  recent(limit: number): Promise<UsageEntry[]>;
}

/** Ledger in Supabase: reads via RLS, writes only through record_ai_usage(). */
export class SupabaseLedger implements UsageLedger {
  readonly mode = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async monthSpendUsd() {
    const { data, error } = await this.db.from("ai_usage").select("est_cost_usd").gte("created_at", startOfMonthUtc().toISOString());
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, r) => sum + Number(r.est_cost_usd), 0);
  }
  async record(e: UsageEntry) {
    const { error } = await this.db.rpc("record_ai_usage", {
      p_workspace: e.workspace_id,
      p_kind: e.kind,
      p_provider: e.provider,
      p_model: e.model,
      p_source: e.source,
      p_input_tokens: e.input_tokens,
      p_output_tokens: e.output_tokens,
      p_images: e.images,
      p_cost: e.est_cost_usd,
      p_status: e.status,
      p_error: e.error,
    });
    if (error) throw new Error(error.message);
  }
  async recent(limit: number) {
    const run = (ws: string) =>
      this.db
        .from("ai_usage")
        .select("workspace_id, kind, provider, model, source, input_tokens, output_tokens, images, est_cost_usd, status, error, created_at, " + ws)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<(Omit<UsageEntry, "workspace_kind"> & { workspaces: WsJoin | WsJoin[] | null })[]>();
    type WsJoin = { kind?: string; slug?: string };
    let res = await run("workspaces(kind, slug)");
    // Database without migration 0013: the niche is the slug.
    if (isMissingColumn(res.error)) res = await run("workspaces(kind)");
    const { data, error } = res;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const ws = r.workspaces;
      const w = Array.isArray(ws) ? ws[0] : ws;
      const kind = w?.slug ?? w?.kind;
      const { workspaces: _omit, ...rest } = r;
      void _omit;
      return { ...rest, est_cost_usd: Number(r.est_cost_usd), workspace_kind: kind } as UsageEntry;
    });
  }
}

/**
 * Demo-mode ledger kept in server memory. It resets when the server restarts,
 * which the Usage page states plainly.
 */
export class MemoryLedger implements UsageLedger {
  readonly mode = "memory" as const;
  private entries: UsageEntry[] = [];

  async monthSpendUsd() {
    const since = startOfMonthUtc().toISOString();
    return this.entries.filter((e) => (e.created_at ?? "") >= since).reduce((s, e) => s + e.est_cost_usd, 0);
  }
  async record(e: UsageEntry) {
    this.entries.push({ ...e, created_at: e.created_at ?? new Date().toISOString() });
  }
  async recent(limit: number) {
    return [...this.entries].reverse().slice(0, limit);
  }
}

const g = globalThis as unknown as { __memoryLedger?: MemoryLedger };
export function memoryLedger(): MemoryLedger {
  g.__memoryLedger ??= new MemoryLedger();
  return g.__memoryLedger;
}
