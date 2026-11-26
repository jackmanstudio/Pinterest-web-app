"use client";
import { useEffect, useState } from "react";
import Link from "./NavLink";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { workspaceHealth, type WorkspaceHealth } from "@/lib/account/health";
import { AccountHealth } from "./AccountHealth";
import { WORKSPACE_KINDS, WORKSPACE_LABELS, type Workspace, type WorkspaceKind } from "@/lib/types";

interface Row {
  kind: WorkspaceKind;
  workspace: Workspace;
  health: WorkspaceHealth;
  autopilot: "on" | "off" | "unavailable";
}

const ACCENT: Record<WorkspaceKind, { badge: string; glow: string }> = {
  fashion: { badge: "bg-gradient-to-br from-[#e60023] to-[#ff7a45]", glow: "bg-rose-500/30" },
  macro: { badge: "bg-gradient-to-br from-violet-500 to-indigo-600", glow: "bg-violet-500/30" },
};

const glass = "au-glass rounded-2xl";

/** AI Account Manager overview: health of every workspace in one place. */
export function Overview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pauseMsg, setPauseMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Demo mode loads the browser store only, so the Supabase client stays out of this page.
      const store = isSupabaseConfigured ? (await import("@/lib/store")).getStore() : (await import("@/lib/store/demo")).getDemoStore();
      return Promise.all(
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
      );
    })()
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

  const anyOn = rows?.some((r) => r.autopilot === "on") ?? false;
  const total = (pick: (h: WorkspaceHealth) => number) => (rows ? rows.reduce((a, r) => a + pick(r.health), 0) : null);
  const summary = [
    { label: "Pins", v: total((h) => h.total), dot: "bg-white/70" },
    { label: "Made this week", v: total((h) => h.madeLast7Days), dot: "bg-emerald-400" },
    { label: "Next 7 days", v: total((h) => h.scheduledNext7Days), dot: "bg-violet-400" },
    { label: "To-dos", v: total((h) => h.recommendations.length), dot: "bg-amber-300" },
  ];

  return (
    <div className="flex flex-col gap-5 pb-4 text-white">
      <section className="pt-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="au-glass rounded-full px-3 py-1 font-medium text-white/75">{WORKSPACE_KINDS.length} accounts</span>
          {!isSupabaseConfigured && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 font-semibold text-amber-200">Demo mode · this browser</span>}
          {anyOn && (
            <button onClick={pauseAll} className="ml-auto rounded-full border border-red-400/40 bg-red-500/15 px-3.5 py-1.5 text-[13px] font-semibold text-red-100 transition hover:bg-red-500/25">
              Pause Autopilot everywhere
            </button>
          )}
        </div>
        <h1 className="mt-5 text-[2.25rem] font-bold leading-[1.05] tracking-tight sm:text-5xl">
          All <span className="au-grad">accounts</span>
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-white/60">
          Health of every account in one place, counted from the pins in this app. Pinterest numbers (impressions, saves, clicks) are on each account&apos;s Analytics tab once Pinterest is connected.
        </p>
      </section>

      {pauseMsg && <p className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{pauseMsg}</p>}
      {err && <p className="rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">Could not load the accounts: {err}</p>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totals across accounts">
        {summary.map((st) => (
          <div key={st.label} className={`${glass} p-4 sm:p-5`}>
            <p className="flex items-center gap-2 text-[13px] font-medium text-white/65">
              <span className={`h-2 w-2 rounded-full ${st.dot}`} aria-hidden />
              {st.label}
            </p>
            <p className="mt-3 text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-5xl">{st.v ?? "–"}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {(rows ?? WORKSPACE_KINDS.map((kind) => ({ kind, workspace: null, health: null, autopilot: "unavailable" as const }))).map(({ kind, workspace, health: h, autopilot }) => (
          <section key={kind} className={`${glass} relative flex flex-col gap-4 overflow-hidden p-5`} aria-busy={!h}>
            <div aria-hidden className={`pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full blur-3xl ${ACCENT[kind].glow}`} />
            <div className="relative flex items-center gap-3">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-base font-bold text-white ${ACCENT[kind].badge}`}>{(workspace?.name ?? WORKSPACE_LABELS[kind]).charAt(0)}</span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold leading-tight">{workspace?.name ?? WORKSPACE_LABELS[kind]}</h2>
                <p className="text-xs text-white/55">{h?.lastPublishedAt ? `Last published ${new Date(h.lastPublishedAt).toLocaleDateString()}` : "Nothing published yet"}</p>
              </div>
              <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${autopilot === "on" ? "border border-emerald-400/30 bg-emerald-500/15 text-emerald-200" : "border border-white/15 bg-white/[0.06] text-white/70"}`}>
                Autopilot {autopilot === "unavailable" ? "needs setup" : autopilot}
              </span>
            </div>

            <AccountHealth h={h} base={`/w/${kind}`} />

            <div className="relative mt-auto flex flex-wrap gap-2">
              <Link href={`/w/${kind}`} className="rounded-xl bg-[#fff] px-4 py-2 text-sm font-bold text-[#0b0912]">Open studio</Link>
              <Link href={`/w/${kind}/analytics`} className="rounded-xl bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/[0.12]">Analytics</Link>
              <Link href={`/w/${kind}/autopilot`} className="rounded-xl bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/[0.12]">Autopilot</Link>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
