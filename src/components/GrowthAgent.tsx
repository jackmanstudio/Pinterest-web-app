"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { WorkspaceKind } from "@/lib/types";

interface Suggestion {
  id: string;
  idea: string;
  reason: string | null;
  evidence: string | null;
  signal: "top_pin" | "trend" | "account" | "gap";
  status: "suggested" | "accepted" | "dismissed";
  created_at: string;
}
interface Run {
  id: string;
  trigger: "manual" | "schedule";
  status: "ok" | "skipped" | "failed";
  provider: string | null;
  kept: number;
  dropped: number;
  detail: string | null;
  created_at: string;
}
type Data =
  | { mode: "demo"; engine: string }
  | { mode: "supabase"; engine: string; needsMigration: true; error: string }
  | { mode: "supabase"; engine: string; needsMigration?: false; settings: { growth_enabled: boolean; ideas_per_run: number }; runs: Run[]; suggestions: Suggestion[] };

const SIGNAL: Record<Suggestion["signal"], string> = {
  top_pin: "from a top pin",
  trend: "trend",
  account: "account pattern",
  gap: "new topic",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Growth agent panel: the agent reads your Pinterest data and suggests ideas;
 * you accept (adds to the Autopilot queue) or dismiss each one.
 */
export function GrowthAgent({ kind, autopilotOn, onQueued }: { kind: WorkspaceKind; autopilotOn: boolean; onQueued?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/agents/growth?workspace=${kind}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Could not load the growth agent");
    setData(body);
  }, [kind]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function post(payload: Record<string, unknown>, ok: (body: Record<string, unknown>) => string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/agents/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: kind, ...payload }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      setNotice(ok(body));
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const live = data && data.mode === "supabase" && !data.needsMigration ? data : null;
  const waiting = live?.suggestions.filter((s) => s.status === "suggested") ?? [];
  const decided = live?.suggestions.filter((s) => s.status !== "suggested").slice(0, 8) ?? [];
  const lastRun = live?.runs[0];

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm" aria-labelledby="growth-agent-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="growth-agent-title" className="font-semibold">Growth agent</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            Reads your own Pinterest data (top pins, saves and clicks, trends) and suggests new pin ideas, each with the reason and the numbers it used.
            <strong> It never posts anything.</strong> Accept an idea to add it to the Autopilot queue, or open it in Studio.
          </p>
          {data && <p className="mt-1 text-xs text-zinc-500">Engine: {data.engine}</p>}
        </div>
        <button
          onClick={() =>
            post({ action: "run" }, (b) =>
              b.status === "ok" ? `${b.kept} new idea${b.kept === 1 ? "" : "s"}${Number(b.dropped) ? ` (${b.dropped} dropped by checks)` : ""}.${b.detail ? ` ${b.detail}` : ""}` : String(b.detail ?? "Nothing to do."),
            )
          }
          disabled={!live || busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Working…" : "Suggest ideas now"}
        </button>
      </div>

      {data?.mode === "demo" && <p className="mt-3 text-sm text-zinc-500">The growth agent needs Supabase and a connected Pinterest account.</p>}
      {data?.mode === "supabase" && data.needsMigration && <p className="mt-3 text-sm text-amber-800">{data.error}</p>}

      {live && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={live.settings.growth_enabled}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  post({ action: "settings", growth_enabled: on, ideas_per_run: live.settings.ideas_per_run }, () => (on ? "The agent will suggest ideas once a day." : "Daily suggestions are off."));
                }}
              />
              Suggest ideas every day
            </label>
            <label className="flex items-center gap-2">
              Ideas per run
              <select
                value={live.settings.ideas_per_run}
                disabled={busy}
                onChange={(e) => post({ action: "settings", growth_enabled: live.settings.growth_enabled, ideas_per_run: Number(e.target.value) }, () => "Saved.")}
                className="rounded border border-zinc-300 px-2 py-1"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {lastRun && (
              <span className="text-xs text-zinc-500">
                Last run {when(lastRun.created_at)} ({lastRun.trigger === "schedule" ? "daily" : "manual"}): {lastRun.status === "ok" ? `${lastRun.kept} ideas` : lastRun.detail}
              </span>
            )}
          </div>
          {!autopilotOn && waiting.length > 0 && (
            <p className="mt-3 text-xs text-amber-800">Autopilot is off, so accepted ideas wait in the queue. Use &quot;Open in Studio&quot; to make pins from an idea yourself.</p>
          )}

          <ul className="mt-4 divide-y divide-zinc-100 text-sm">
            {waiting.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-3">
                <div className="flex-1">
                  <span className="mr-1 rounded bg-violet-100 px-1 text-[10px] font-semibold uppercase text-violet-800">{SIGNAL[s.signal]}</span>
                  <span className="font-medium">{s.idea}</span>
                  {s.reason && <span className="block text-zinc-600">{s.reason}</span>}
                  {s.evidence && <span className="block text-xs text-zinc-500">Based on: {s.evidence}</span>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => post({ action: "accept", id: s.id }, () => "Added to the Autopilot queue.").then((ok) => ok && onQueued?.())}
                    disabled={busy}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Accept
                  </button>
                  <Link href={`/w/${kind}?idea=${encodeURIComponent(s.idea)}`} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium">
                    Open in Studio
                  </Link>
                  <button onClick={() => post({ action: "dismiss", id: s.id }, () => "Dismissed.")} disabled={busy} className="px-2 py-1.5 text-xs text-zinc-500 hover:text-red-700">
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
            {waiting.length === 0 && <li className="py-2 text-zinc-500">No ideas waiting. Refresh Analytics, then click &quot;Suggest ideas now&quot;.</li>}
          </ul>

          {decided.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-zinc-500">Recent decisions</summary>
              <ul className="mt-2 space-y-1">
                {decided.map((s) => (
                  <li key={s.id} className="text-zinc-600">
                    <span className={s.status === "accepted" ? "text-emerald-700" : "text-zinc-400"}>{s.status}</span> · {s.idea}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
