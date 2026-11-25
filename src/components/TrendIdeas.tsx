"use client";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot, TrendKeyword } from "@/lib/analytics/types";
import { freshness } from "@/lib/analytics/parse";
import { seasonalIdeas } from "@/lib/ideas/seasonal";
import type { Store } from "@/lib/store";
import type { WorkspaceKind } from "@/lib/types";

interface Props {
  kind: WorkspaceKind;
  store: Store;
  workspaceId: string;
  onPick: (idea: string) => void;
}

const pct = (t: TrendKeyword) => t.pct_growth_wow ?? t.pct_growth_mom ?? t.pct_growth_yoy;

/** Topic suggestions: live Pinterest Trends when available, otherwise clearly labelled seasonal ideas. */
export function TrendIdeas({ kind, store, workspaceId, onPick }: Props) {
  const [trends, setTrends] = useState<Snapshot<TrendKeyword[]> | null>(null);
  const [canFetch, setCanFetch] = useState(false);
  const [seasonal, setSeasonal] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [brand, res] = await Promise.all([store.getBrand(workspaceId).catch(() => null), fetch(`/api/analytics?workspace=${kind}`).catch(() => null)]);
    setSeasonal(seasonalIdeas(kind, new Date(), brand?.focus_keywords ?? []));
    const body = res?.ok ? await res.json() : null;
    setTrends((body?.snapshots?.trends as Snapshot<TrendKeyword[]> | undefined) ?? null);
    setCanFetch(Boolean(body && body.mode === "supabase" && body.pinterestConfigured));
  }, [kind, store, workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, type: "growing", ...(kind === "fashion" ? { interest: "womens_fashion" } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not fetch trends");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const live = trends?.data?.length ? trends : null;
  const chip = "rounded-full border px-3 py-1 text-sm hover:bg-zinc-50";
  return (
    <div className="mt-4 border-t border-zinc-100 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{live ? "Trending on Pinterest" : "Seasonal ideas"}</h2>
        {live ? (
          <span className="text-xs text-zinc-500">Pinterest Trends · {freshness(live.fetched_at)}</span>
        ) : (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">Calendar suggestions, not live trend data</span>
        )}
        {canFetch && (
          <button onClick={refresh} disabled={busy} className="ml-auto text-xs text-zinc-600 underline disabled:opacity-50">
            {busy ? "Fetching…" : live ? "Refresh trends" : "Get live trends"}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {live
          ? live.data.slice(0, 12).map((t) => (
              <button key={t.keyword} onClick={() => onPick(t.keyword)} className={`${chip} border-emerald-200`}>
                {t.keyword}
                {pct(t) != null && <span className="ml-1 text-xs text-emerald-700">+{Math.round(pct(t)!)}%</span>}
              </button>
            ))
          : seasonal.map((s) => (
              <button key={s} onClick={() => onPick(s)} className={`${chip} border-zinc-200`}>
                {s}
              </button>
            ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
