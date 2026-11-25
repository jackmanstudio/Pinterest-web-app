"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getStore } from "@/lib/store";
import { workspaceHealth, type WorkspaceHealth } from "@/lib/account/health";
import { STATUS_LABELS, WORKSPACE_KINDS, type DraftStatus, type Workspace, type WorkspaceKind } from "@/lib/types";

interface Row {
  kind: WorkspaceKind;
  workspace: Workspace;
  health: WorkspaceHealth;
  autopilot: "on" | "off" | "unavailable";
}

const PRIORITY = { high: "bg-red-100 text-red-800", medium: "bg-amber-100 text-amber-800", low: "bg-zinc-100 text-zinc-700" };

/** AI Account Manager overview: health of every workspace in one place. */
export function Overview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pauseMsg, setPauseMsg] = useState<string | null>(null);

  useEffect(() => {
    const store = getStore();
    Promise.all(
      WORKSPACE_KINDS.map(async (kind) => {
        const workspace = await store.getWorkspace(kind);
        const [drafts, brand] = await Promise.all([store.listDrafts(workspace.id), store.getBrand(workspace.id)]);
        let autopilot: Row["autopilot"] = "unavailable";
        if (store.mode === "supabase") {
          const r = await fetch(`/api/autopilot?workspace=${kind}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
          if (r) autopilot = r.settings?.enabled ? "on" : "off";
        }
        return { kind, workspace, health: workspaceHealth(drafts, brand), autopilot };
      }),
    )
      .then(setRows)
      .catch((e: Error) => setErr(e.message));
  }, []);

  async function pauseAll() {
    if (!rows) return;
    const results = await Promise.all(
      rows.map((r) =>
        fetch("/api/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pause", workspace: r.kind }) })
          .then((x) => x.ok)
          .catch(() => false),
      ),
    );
    setRows(rows.map((r) => ({ ...r, autopilot: r.autopilot === "on" ? "off" : r.autopilot })));
    setPauseMsg(results.every(Boolean) ? "Autopilot is paused on every account. Turn it on again from each Autopilot tab." : "Some accounts could not be paused; check the Autopilot tab.");
  }

  if (err) return <p className="text-red-700">Could not load the overview: {err}</p>;
  if (!rows) return <p className="text-zinc-500">Loading accounts…</p>;
  const anyOn = rows.some((r) => r.autopilot === "on");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">All accounts overview</h1>
        {anyOn && (
          <button onClick={pauseAll} className="ml-auto rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white">
            Pause Autopilot on all accounts
          </button>
        )}
      </div>
      {pauseMsg && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{pauseMsg}</p>}
      <p className="text-sm text-zinc-600">Built from the pins in this app. Pinterest numbers (impressions, saves, clicks) are on each account&apos;s Analytics tab once Pinterest is connected.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {rows.map(({ kind, workspace, health: h, autopilot }) => (
          <section key={kind} className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{workspace.name}</h2>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${autopilot === "on" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>
                Autopilot {autopilot === "unavailable" ? "needs setup" : autopilot}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Pins", h.total],
                ["Made this week", h.madeLast7Days],
                ["Published (30 days)", h.publishedLast30Days],
                ["Scheduled (7 days)", h.scheduledNext7Days],
                ["No image", h.noImage],
                ["Need quality fixes", h.lowQuality],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-lg bg-zinc-50 p-2">
                  <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
                  <dt className="text-xs text-zinc-600">{label}</dt>
                </div>
              ))}
            </dl>
            <p className="text-xs text-zinc-600">
              {(Object.keys(h.byStatus) as DraftStatus[]).map((s) => `${STATUS_LABELS[s]} ${h.byStatus[s]}`).join(" · ")}
              {h.archived ? ` · Archived ${h.archived}` : ""}
              {h.lastPublishedAt ? ` · Last published ${new Date(h.lastPublishedAt).toLocaleDateString()}` : ""}
            </p>
            <div>
              <h3 className="mb-2 text-sm font-semibold">What to do next</h3>
              {h.recommendations.length === 0 && <p className="text-sm text-emerald-700">All good. Nothing needs attention.</p>}
              <ul className="flex flex-col gap-2">
                {h.recommendations.map((r) => (
                  <li key={r.text} className="flex items-start gap-2 text-sm">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${PRIORITY[r.priority]}`}>{r.priority}</span>
                    <Link href={`/w/${kind}${r.href ? `/${r.href}` : ""}`} className="hover:underline">{r.text}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
