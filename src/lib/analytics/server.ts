import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PinterestApi } from "@/lib/pinterest/api";
import type { Snapshot } from "./types";

export async function saveSnapshot(
  admin: SupabaseClient,
  s: { workspaceId: string; kind: Snapshot<unknown>["kind"]; source: string; environment: string; start?: string; end?: string; params?: Record<string, unknown>; data: unknown },
): Promise<string> {
  const { data, error } = await admin
    .from("analytics_snapshots")
    .insert({
      workspace_id: s.workspaceId, kind: s.kind, source: s.source, environment: s.environment,
      start_date: s.start ?? null, end_date: s.end ?? null, params: s.params ?? {}, data: s.data,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function latestSnapshots(db: SupabaseClient, workspaceId: string) {
  const kinds = ["account", "top_pins", "published_pins", "trends"] as const;
  const out: Partial<Record<(typeof kinds)[number], Snapshot<unknown>>> = {};
  await Promise.all(
    kinds.map(async (k) => {
      const { data } = await db
        .from("analytics_snapshots")
        .select("id, kind, source, environment, start_date, end_date, params, data, fetched_at")
        .eq("workspace_id", workspaceId)
        .eq("kind", k)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) out[k] = data as Snapshot<unknown>;
    }),
  );
  return out;
}

export const analyticsCalls = (api: PinterestApi) => ({
  account: (t: string, start: string, end: string) =>
    api.get<unknown>(t, "/user_account/analytics", { start_date: start, end_date: end, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK,ENGAGEMENT,ENGAGEMENT_RATE" }),
  topPins: (t: string, start: string, end: string) =>
    api.get<unknown>(t, "/user_account/analytics/top_pins", { start_date: start, end_date: end, sort_by: "SAVE", num_of_pins: 10, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" }),
  pin: (t: string, pinId: string, start: string, end: string) =>
    api.get<unknown>(t, `/pins/${encodeURIComponent(pinId)}/analytics`, { start_date: start, end_date: end, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" }),
  trends: (t: string, region: string, type: string, interest?: string) =>
    api.get<unknown>(t, `/trends/keywords/${encodeURIComponent(region)}/top/${encodeURIComponent(type)}`, { limit: 20, ...(interest ? { interests: interest } : {}) }),
});
