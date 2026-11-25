"use client";
import { useCallback, useEffect, useState } from "react";
import { compactNumber, freshness } from "@/lib/analytics/parse";
import { sampleSnapshots } from "@/lib/analytics/sample";
import { METRIC_LABELS, type AccountAnalytics, type Insight, type PublishedPinStats, type Snapshot, type TopPin, type TrendKeyword } from "@/lib/analytics/types";
import { WORKSPACE_LABELS, type WorkspaceKind } from "@/lib/types";
import { DailyBars } from "./DailyBars";

interface ApiData {
  mode: "demo" | "supabase";
  pinterestConfigured: boolean;
  insightsAvailable: boolean;
  textProvider: string;
  snapshots: Partial<Record<"account" | "top_pins" | "published_pins" | "trends", Snapshot<unknown>>>;
  insights: { provider: string; model: string | null; insights: Insight[]; dropped: number; created_at: string } | null;
}

const TILES = ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK", "ENGAGEMENT_RATE"];

function Source({ s, sample }: { s: Snapshot<unknown>; sample: boolean }) {
  return (
    <p className={`text-xs ${sample ? "font-semibold text-amber-800" : "text-zinc-500"}`}>
      Source: {s.source}
      {s.start_date && s.end_date ? ` · ${s.start_date} → ${s.end_date} (UTC)` : s.end_date ? ` · as of ${s.end_date}` : ""}
      {!sample && ` · fetched ${freshness(s.fetched_at)} · ${s.environment === "sandbox" ? "Sandbox" : "Production"}`}
    </p>
  );
}

function fmt(metric: string, v: number | undefined) {
  if (v === undefined) return "—";
  return metric.endsWith("_RATE") ? `${(v * 100).toFixed(1)}%` : compactNumber(v);
}

export function Analytics({ kind }: { kind: WorkspaceKind }) {
  const [data, setData] = useState<ApiData | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [busy, setBusy] = useState<"idle" | "refresh" | "trends" | "insights">("idle");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [region, setRegion] = useState("US");
  const [trendType, setTrendType] = useState("growing");
  const [interest, setInterest] = useState(kind === "fashion" ? "womens_fashion" : "");

  const load = useCallback(async () => {
    const r = await fetch(`/api/analytics?workspace=${kind}`);
    const body = await r.json();
    if (!r.ok) setMsg({ ok: false, text: body.error ?? "Could not load analytics" });
    else setData(body);
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/analytics?workspace=${kind}`)
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) setMsg({ ok: false, text: body.error ?? "Could not load analytics" });
        else setData(body);
      })
      .catch(() => !cancelled && setMsg({ ok: false, text: "Could not reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function post(path: string, body: Record<string, unknown>, kindOfBusy: typeof busy, ok: (b: Record<string, unknown>) => string) {
    setBusy(kindOfBusy);
    setMsg(null);
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: kind, ...body }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Request failed");
      setMsg({ ok: true, text: ok(b) });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  }

  if (!data) return <p className="text-zinc-500">{msg?.text ?? "Loading analytics…"}</p>;

  const sample = preview && data.mode === "demo";
  const snaps = sample ? sampleSnapshots() : data.snapshots;
  const account = snaps.account as Snapshot<AccountAnalytics> | undefined;
  const top = snaps.top_pins as Snapshot<TopPin[]> | undefined;
  const published = snaps.published_pins as Snapshot<PublishedPinStats[]> | undefined;
  const trends = snaps.trends as Snapshot<TrendKeyword[]> | undefined;
  const canFetch = data.mode === "supabase" && data.pinterestConfigured;
  const card = "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{WORKSPACE_LABELS[kind]} · Analytics</h1>
          <p className="mt-1 text-sm text-zinc-600">Only verified data from the official Pinterest API, with its source, date range and freshness.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-zinc-100 p-1" role="group" aria-label="Date range">
            {([7, 30, 90] as const).map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 text-sm ${days === d ? "bg-white font-medium shadow-sm" : "text-zinc-600"}`}>{d} days</button>
            ))}
          </div>
          <button
            disabled={!canFetch || busy !== "idle"}
            onClick={() => post("/api/analytics/refresh", { days }, "refresh", (b) => `Fetched ${b.start} → ${b.end}.`)}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "refresh" ? "Fetching from Pinterest…" : "Refresh from Pinterest"}
          </button>
        </div>
      </div>

      {msg && <p className={`rounded-md p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">{msg.text}</p>}

      {data.mode === "demo" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>Demo mode: real analytics need Supabase and a connected Pinterest account.</span>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview layout with SAMPLE data
          </label>
        </div>
      )}
      {data.mode === "supabase" && !data.pinterestConfigured && (
        <p className="rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm">Pinterest isn&apos;t configured on the server yet, so there is no analytics data. See the Pinterest tab.</p>
      )}
      {sample && <p className="rounded-md bg-amber-100 p-2 text-center text-sm font-semibold text-amber-900">SAMPLE DATA — not your Pinterest numbers</p>}

      <section className={card}>
        <h2 className="text-lg font-semibold">Account overview</h2>
        {account ? (
          <>
            <Source s={account} sample={sample} />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {TILES.map((m) => (
                <div key={m} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-xs text-zinc-600">{METRIC_LABELS[m]}</p>
                  <p className="mt-1 text-2xl font-semibold">{fmt(m, account.data.summary[m])}</p>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <DailyBars points={account.data.daily} metric="IMPRESSION" label="Impressions" />
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">No analytics fetched yet.{canFetch ? " Click “Refresh from Pinterest”." : ""}</p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-lg font-semibold">Top pins by saves</h2>
          {top ? (
            <>
              <Source s={top} sample={sample} />
              {top.data.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">Pinterest returned no top pins for this range.</p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500"><tr><th className="py-1">Pin</th><th>Impr.</th><th>Saves</th><th>Clicks</th><th>Outbound</th></tr></thead>
                  <tbody>
                    {top.data.map((p) => (
                      <tr key={p.pin_id} className="border-t border-zinc-100">
                        <td className="py-1.5">{sample ? p.pin_id : <a className="text-red-700 underline" href={`https://www.pinterest.com/pin/${p.pin_id}/`} target="_blank" rel="noreferrer">{p.pin_id}</a>}</td>
                        <td>{fmt("IMPRESSION", p.metrics.IMPRESSION)}</td><td>{fmt("SAVE", p.metrics.SAVE)}</td><td>{fmt("PIN_CLICK", p.metrics.PIN_CLICK)}</td><td>{fmt("OUTBOUND_CLICK", p.metrics.OUTBOUND_CLICK)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">Not fetched yet.</p>
          )}
        </section>

        <section className={card}>
          <h2 className="text-lg font-semibold">Pins published from this studio</h2>
          {published ? (
            <>
              <Source s={published} sample={sample} />
              {published.data.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">Nothing published from this workspace yet.</p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500"><tr><th className="py-1">Pin</th><th>Impr.</th><th>Saves</th><th>Clicks</th></tr></thead>
                  <tbody>
                    {published.data.map((p) => (
                      <tr key={p.pin_id} className="border-t border-zinc-100">
                        <td className="py-1.5">{p.title}{p.error && <span className="block text-xs text-red-700">{p.error}</span>}</td>
                        <td>{fmt("IMPRESSION", p.summary.IMPRESSION)}</td><td>{fmt("SAVE", p.summary.SAVE)}</td><td>{fmt("PIN_CLICK", p.summary.PIN_CLICK)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">Not fetched yet.</p>
          )}
        </section>
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Pinterest Trends</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select aria-label="Region" className="rounded-md border border-zinc-300 px-2 py-1" value={region} onChange={(e) => setRegion(e.target.value)}>
              {["US", "CA", "GB+IE", "AU+NZ", "DE", "FR"].map((r) => <option key={r}>{r}</option>)}
            </select>
            <select aria-label="Trend type" className="rounded-md border border-zinc-300 px-2 py-1" value={trendType} onChange={(e) => setTrendType(e.target.value)}>
              {["growing", "monthly", "yearly", "seasonal"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <select aria-label="Interest" className="rounded-md border border-zinc-300 px-2 py-1" value={interest} onChange={(e) => setInterest(e.target.value)}>
              <option value="">All interests</option>
              {["womens_fashion", "mens_fashion", "beauty", "home_decor", "food_and_drinks", "travel", "art", "design"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
            <button
              disabled={!canFetch || busy !== "idle"}
              onClick={() => post("/api/analytics/trends", { region, type: trendType, interest: interest || undefined }, "trends", (b) => `Loaded ${b.count} trending keywords.`)}
              className="rounded-md border border-zinc-300 px-3 py-1 font-medium disabled:opacity-50"
            >
              {busy === "trends" ? "Loading…" : "Load trends"}
            </button>
          </div>
        </div>
        {trends ? (
          <>
            <Source s={trends} sample={sample} />
            <ul className="mt-3 divide-y divide-zinc-100 text-sm">
              {trends.data.map((t) => (
                <li key={t.keyword} className="flex justify-between py-1.5">
                  <span>{t.keyword}</span>
                  <span className="text-zinc-600">{t.pct_growth_mom !== null ? `${t.pct_growth_mom > 0 ? "+" : ""}${t.pct_growth_mom}% month over month` : ""}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">Not loaded. Pinterest only returns Trends if your app has been granted access.</p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Growth insights (AI)</h2>
            <button
              disabled={sample || !data.insightsAvailable || data.mode !== "supabase" || !data.snapshots.account || busy !== "idle"}
              onClick={() => post("/api/analytics/insights", {}, "insights", (b) => `Generated ${b.kept} insight(s)${Number(b.dropped) ? `; ${b.dropped} dropped for quoting numbers not in your data` : ""}.`)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium disabled:opacity-50"
            >
              {busy === "insights" ? "Analysing…" : "Generate insights"}
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Reads only the stored Pinterest data above. Any insight quoting a number that isn&apos;t in that data is discarded.</p>
          {!data.insightsAvailable && <p className="mt-2 text-sm text-zinc-600">Needs a real text AI key (TEXT_AI_API_KEY). Demo mode won&apos;t make up analysis.</p>}
          {data.insights && !sample ? (
            <>
              <p className="mt-2 text-xs text-zinc-500">
                {data.insights.provider}{data.insights.model ? ` (${data.insights.model})` : ""} · {freshness(data.insights.created_at)}
                {data.insights.dropped ? ` · ${data.insights.dropped} unverifiable insight(s) removed` : ""}
              </p>
              {data.insights.insights.length === 0 && <p className="mt-2 text-sm text-zinc-600">Not enough data for a reliable insight yet.</p>}
              <ul className="mt-3 flex flex-col gap-3">
                {data.insights.insights.map((i, n) => (
                  <li key={n} className="rounded-md border border-zinc-200 p-3 text-sm">
                    <p className="font-medium">{i.title}</p>
                    <p className="mt-1 text-zinc-700">{i.detail}</p>
                    <p className="mt-1 text-xs text-zinc-500">Evidence: {i.evidence}</p>
                    <p className="mt-1 text-sm"><span className="font-medium">Next step:</span> {i.action}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className={card}>
          <h2 className="text-lg font-semibold">Competitor tracking</h2>
          <p className="mt-2 text-sm text-zinc-600">
            <strong>Not available.</strong> Pinterest&apos;s API does not provide analytics for accounts you don&apos;t own, and this app doesn&apos;t scrape. It will
            stay off until an authorised data source is connected.
          </p>
        </section>
      </div>
    </div>
  );
}
