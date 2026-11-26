"use client";
import { PageTitle } from "./PageTitle";
import { ContentSources, type SourceRow } from "./ContentSources";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { type WorkspaceKind } from "@/lib/types";

const CONSENT = "AUTO PUBLISH";

interface Settings {
  enabled: boolean;
  board_id: string | null;
  board_name: string | null;
  pins_per_day: number;
  link: string | null;
  enabled_at: string | null;
  paused_reason: string | null;
  last_run_at: string | null;
  timezone: string;
  best_time: boolean;
  remix_winners: boolean;
  auto_trends: boolean;
  trend_interest: string | null;
}
interface BestTimeInfo {
  hours: number[];
  basis: "data" | "default";
  detail: string;
}
const INTERESTS: Record<string, string> = {
  womens_fashion: "Women's fashion", mens_fashion: "Men's fashion", beauty: "Beauty", home_decor: "Home decor",
  food_and_drinks: "Food & drinks", travel: "Travel", art: "Art", design: "Design",
};
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
/** Collapses [12,13,14,18,19] into "12pm–3pm, 6pm–8pm". */
function hoursText(hours: number[]): string {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const h of sorted) {
    const last = runs.at(-1);
    if (last && h === last[1] + 1) last[1] = h;
    else runs.push([h, h]);
  }
  return runs.map(([a, b]) => `${hourLabel(a)}–${hourLabel((b + 1) % 24)}`).join(", ");
}
interface IdeaRow {
  id: string;
  idea: string;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  source: "user" | "trends" | "agent" | "feed";
  created_at: string;
}
interface RecentPin {
  id: string;
  title: string;
  status: string;
  external_pin_id: string | null;
  published_at: string | null;
  review_note: string | null;
}
type Data =
  | { mode: "demo"; readiness: string[] }
  | { mode: "supabase"; settings: Settings; bestTime: BestTimeInfo; ideas: IdeaRow[]; boards: { board_id: string; name: string }[]; recent: RecentPin[]; readiness: string[]; sources?: SourceRow[]; sourcesNeedMigration?: boolean };

const IDEA_STYLE: Record<IdeaRow["status"], string> = {
  queued: "bg-zinc-100 text-zinc-700",
  processing: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function Autopilot({ kind }: { kind: WorkspaceKind }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ideasText, setIdeasText] = useState("");
  const [form, setForm] = useState({
    boardId: "", pinsPerDay: 3, link: "", consent: "", bestTime: true, remixWinners: true, autoTrends: false,
    trendInterest: (kind === "fashion" ? "womens_fashion" : "") as string,
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/autopilot?workspace=${kind}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Could not load Autopilot");
    setData(body);
    if (body.mode === "supabase") {
      const st = body.settings as Settings;
      setForm((f) => ({
        ...f, boardId: st.board_id ?? "", pinsPerDay: st.pins_per_day, link: st.link ?? "",
        bestTime: st.best_time, remixWinners: st.remix_winners, autoTrends: st.auto_trends, trendInterest: st.trend_interest ?? "",
      }));
    }
  }, [kind]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function post(payload: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: kind, ...payload }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      setNotice(body.outcome ? body.outcome.detail : ok);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-zinc-500">{error ?? "Loading Autopilot…"}</p>;

  const live = data.mode === "supabase" ? data : null;
  const s = live?.settings;
  const boards = live?.boards ?? [];
  const save = (enabled: boolean) =>
    post(
      {
        action: "save",
        enabled,
        consent: form.consent,
        boardId: form.boardId || null,
        boardName: boards.find((b) => b.board_id === form.boardId)?.name ?? null,
        pinsPerDay: form.pinsPerDay,
        link: form.link,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        bestTime: form.bestTime,
        remixWinners: form.remixWinners,
        autoTrends: form.autoTrends,
        trendInterest: form.trendInterest || null,
      },
      enabled ? "Autopilot is on." : "Autopilot is paused.",
    ).then((done) => done && setForm((f) => ({ ...f, consent: "" })));
  const queued = live?.ideas.filter((i) => i.status === "queued").length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        kind={kind}
        title="Run on"
        accent="Autopilot"
        chips={<span className={`rounded-full border px-3 py-1 font-bold ${s?.enabled ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-white/15 bg-white/[0.06] text-white/70"}`}>{s?.enabled ? "ON" : "OFF"}</span>}
      />
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="max-w-3xl text-sm text-zinc-600">
          Add titles or ideas to the queue. Every hour, Autopilot turns the next idea into a full set of 5 pins, one per angle (AI text; photos from your page or AI images), then posts them to your
          board one at a time, up to your daily limit, within the monthly AI budget. <strong>Pins are published without asking you first.</strong>{" "}
          Pause it any time.
        </p>
        {s?.enabled && s.paused_reason && (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <strong>Waiting:</strong> {s.paused_reason}
          </p>
        )}
        {s && <p className="mt-2 text-xs text-zinc-500">Last run: {fmt(s.last_run_at)}{s.enabled ? ` · on since ${fmt(s.enabled_at)}` : ""}</p>}
      </section>

      {data.readiness.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">Before Autopilot can post</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
            {data.readiness.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">You can set everything up now. It starts posting as soon as these are done.</p>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Settings</h2>
          <fieldset disabled={!live || busy} className="mt-3 flex flex-col gap-3 disabled:opacity-60">
            <label className="text-sm">
              Board to post to
              <select className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2" value={form.boardId} onChange={(e) => setForm({ ...form, boardId: e.target.value })}>
                <option value="">{boards.length ? "Choose a board" : "Connect Pinterest and sync boards first"}</option>
                {boards.map((b) => (
                  <option key={b.board_id} value={b.board_id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Pins per day (max 10)
              <input type="number" min={1} max={10} className="mt-1 block w-32 rounded-md border border-zinc-300 px-3 py-2" value={form.pinsPerDay}
                onChange={(e) => setForm({ ...form, pinsPerDay: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
              <span className="mt-1 block text-xs text-zinc-500">Spread across the day, at least {Math.round((24 / form.pinsPerDay) * 0.9 * 10) / 10} hours apart.</span>
            </label>
            <label className="text-sm">
              Link on every pin (optional)
              <input className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2" placeholder="https://your-site.com" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
              <span className="mt-1 block text-xs text-zinc-500">Empty = your brand website from Brand &amp; categories.</span>
            </label>
            <fieldset className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Smart features</legend>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={form.bestTime} onChange={(e) => setForm({ ...form, bestTime: e.target.checked })} />
                <span>
                  Post at the best times
                  {live && (
                    <span className="block text-xs text-zinc-500">
                      {hoursText(live.bestTime.hours)} ({live.settings.timezone}). {live.bestTime.detail}
                    </span>
                  )}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={form.remixWinners} onChange={(e) => setForm({ ...form, remixWinners: e.target.checked })} />
                <span>
                  Remake winning pins
                  <span className="block text-xs text-zinc-500">When the queue is empty, at most once a week, make fresh versions of your pin with the most saves and clicks.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={form.autoTrends} onChange={(e) => setForm({ ...form, autoTrends: e.target.checked })} />
                <span>
                  Use Pinterest Trends when the queue is empty
                  <span className="block text-xs text-zinc-500">Picks the fastest-growing trend that fits your topic. Needs Trends access on your Pinterest app.</span>
                </span>
              </label>
              {form.autoTrends && (
                <label className="ml-6 text-xs text-zinc-600">
                  Trend topic{" "}
                  <select className="rounded border border-zinc-300 px-1 py-0.5" value={form.trendInterest} onChange={(e) => setForm({ ...form, trendInterest: e.target.value })}>
                    <option value="">Any (filtered by your focus keywords)</option>
                    {Object.entries(INTERESTS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>
            {s?.enabled ? (
              <div className="flex flex-wrap gap-3">
                <button onClick={() => save(true)} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium">Save changes</button>
                <button onClick={() => save(false)} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Pause Autopilot</button>
                <button onClick={() => post({ action: "run_now" }, "Ran one step.")} className="rounded-md px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100">Run one step now</button>
              </div>
            ) : (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <label className="text-sm text-red-900">
                  Type <span className="font-mono font-semibold">{CONSENT}</span> to let Autopilot publish pins to Pinterest without asking each time
                  <input aria-label="Consent phrase" className="mt-1 block w-full max-w-xs rounded-md border border-red-300 bg-white px-3 py-2 font-mono text-sm" value={form.consent}
                    onChange={(e) => setForm({ ...form, consent: e.target.value })} />
                </label>
                <button onClick={() => save(true)} disabled={form.consent !== CONSENT || !form.boardId}
                  className="mt-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  Turn on Autopilot
                </button>
              </div>
            )}
          </fieldset>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Idea queue {live && <span className="font-normal text-zinc-500">· {queued} waiting</span>}</h2>
          <p className="mt-1 text-xs text-zinc-500">One title or idea per line. Each one becomes a set of 5 pins, one per angle (in the Studio you choose 1 to 5).</p>
          <textarea rows={4} disabled={!live || busy} className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60"
            placeholder={kind === "fashion" ? "Autumn trench coat outfits\nMinimalist capsule wardrobe for work" : "One idea per line"}
            value={ideasText} onChange={(e) => setIdeasText(e.target.value)} />
          <button
            disabled={!live || busy || !ideasText.trim()}
            onClick={() => {
              const ideas = ideasText.split("\n").map((l) => l.trim()).filter((l) => l.length >= 3);
              post({ action: "add_ideas", ideas }, `Added ${ideas.length} idea${ideas.length === 1 ? "" : "s"}.`).then((ok) => ok && setIdeasText(""));
            }}
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Add to queue
          </button>
          <ul className="mt-4 divide-y divide-zinc-100 text-sm">
            {(live?.ideas ?? []).map((i) => (
              <li key={i.id} className="flex items-start gap-2 py-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${IDEA_STYLE[i.status]}`}>{i.status}</span>
                <span className="flex-1">
                  {i.source !== "user" && <span className="mr-1 rounded bg-violet-100 px-1 text-[10px] font-semibold uppercase text-violet-800">{i.source === "trends" ? "trend" : i.source === "feed" ? "from your site" : "winner remake"}</span>}
                  {i.idea}
                  {i.error && <span className="block text-xs text-red-700">{i.error}</span>}
                </span>
                {i.status !== "processing" && (
                  <button onClick={() => post({ action: "delete_idea", id: i.id }, "Removed.")} disabled={busy} className="text-xs text-zinc-500 hover:text-red-700">
                    Remove
                  </button>
                )}
              </li>
            ))}
            {live && live.ideas.length === 0 && <li className="py-2 text-zinc-500">No ideas yet.</li>}
          </ul>
        </section>
      </div>

      <ContentSources sources={live?.sources ?? []} needsMigration={Boolean(live?.sourcesNeedMigration)} disabled={!live || busy} post={post} />

      {live && live.recent.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Autopilot pins</h2>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr><th className="py-1">Title</th><th>Status</th><th>Published</th></tr>
            </thead>
            <tbody>
              {live.recent.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="py-1.5">{p.title}{p.review_note && p.status === "draft" && <span className="block text-xs text-amber-800">{p.review_note}</span>}</td>
                  <td>{p.status}</td>
                  <td>{p.external_pin_id ? <a className="underline" href={`https://www.pinterest.com/pin/${p.external_pin_id}/`} target="_blank" rel="noreferrer">{fmt(p.published_at)}</a> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-zinc-500">
        Prefer to check pins first? Leave Autopilot off and use <Link className="underline" href={`/w/${kind}`}>Studio</Link> plus{" "}
        <Link className="underline" href={`/w/${kind}/publish`}>Review &amp; publish</Link>.
      </p>
    </div>
  );
}
