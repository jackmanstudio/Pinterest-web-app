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
  const chip = "inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-[13px] font-medium text-white/85 ring-1 transition hover:bg-white/[0.12] hover:text-white";
  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">{live ? "Trending on Pinterest" : "Seasonal ideas"}</h2>
        {live ? (
          <span className="text-xs text-zinc-500">Pinterest Trends · {freshness(live.fetched_at)}</span>
        ) : (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/50 ring-1 ring-white/10">Calendar suggestions, not live trend data</span>
        )}
        {canFetch && (
          <button onClick={refresh} disabled={busy} className="ml-auto rounded-lg px-2.5 py-1 text-xs font-semibold text-[#ff9a7a] hover:bg-white/[0.06] disabled:opacity-50">
            {busy ? "Fetching…" : live ? "Refresh trends" : "Get live trends"}
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {live
          ? live.data.slice(0, 12).map((t) => (
              <button key={t.keyword} onClick={() => onPick(t.keyword)} className={`${chip} ring-emerald-400/30`}>
                {t.keyword}
                {pct(t) != null && <span className="text-xs font-semibold text-emerald-300">+{Math.round(pct(t)!)}%</span>}
              </button>
            ))
          : seasonal.map((s) => (
              <button key={s} onClick={() => onPick(s)} className={`${chip} ring-white/12`}>
                <span aria-hidden className="text-[#ff9a7a]">+</span> {s}
              </button>
            ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
