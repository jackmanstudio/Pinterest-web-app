"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { WORKSPACE_LABELS, type WorkspaceKind } from "@/lib/types";

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
}
interface IdeaRow {
  id: string;
  idea: string;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
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
  | { mode: "supabase"; settings: Settings; ideas: IdeaRow[]; boards: { board_id: string; name: string }[]; recent: RecentPin[]; readiness: string[] };

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
  const [form, setForm] = useState({ boardId: "", pinsPerDay: 3, link: "", consent: "" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/autopilot?workspace=${kind}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Could not load Autopilot");
    setData(body);
    if (body.mode === "supabase") setForm((f) => ({ ...f, boardId: body.settings.board_id ?? "", pinsPerDay: body.settings.pins_per_day, link: body.settings.link ?? "" }));
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
      },
      enabled ? "Autopilot is on." : "Autopilot is paused.",
    ).then((done) => done && setForm((f) => ({ ...f, consent: "" })));
  const queued = live?.ideas.filter((i) => i.status === "queued").length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{WORKSPACE_LABELS[kind]} Autopilot</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}>
            {s?.enabled ? "ON" : "OFF"}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          Add titles or ideas to the queue. Every hour, Autopilot turns the next idea into 5 pins (AI text and AI image), then posts them to your
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

      <div className="grid gap-6 lg:grid-cols-2">
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
          <p className="mt-1 text-xs text-zinc-500">One title or idea per line. Each one becomes 5 pins.</p>
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
