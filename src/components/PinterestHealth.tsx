"use client";
import { useCallback, useEffect, useState } from "react";
import type { WorkspaceKind } from "@/lib/types";

interface Job { id: string; title: string; status: string; board_name: string | null; run_at: string; timezone: string | null; attempts: number; last_error: string | null; external_pin_id: string | null }
interface Health {
  error?: string;
  demo?: boolean;
  config: { ready: boolean; missing: string[]; env: "sandbox" | "production" };
  connection?: { username: string; scopes: string[]; status: string; access_expires_at: string; refresh_expires_at: string | null } | null;
  token?: { access: string; login: string };
  paused?: boolean;
  pauseSupported?: boolean;
  workers?: { publish: { state: string; last_run_at: string | null }; autopilot: { state: string; last_run_at: string | null } } | null;
  queue?: { queued: number; running: number; failed7d: number; published7d: number };
  lastError?: string | null;
  jobs?: Job[];
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "never");
const TONE: Record<string, string> = { ok: "text-emerald-700", expiring: "text-amber-700", late: "text-amber-700", never: "text-zinc-500", unknown: "text-zinc-500", expired: "text-red-700", error: "text-red-700" };
const WORKER_TEXT: Record<string, string> = { ok: "running on time", late: "late (check the cron job)", never: "has not run yet (set up the cron job)", error: "last run had an error" };
const JOB_TONE: Record<string, string> = { queued: "bg-sky-100 text-sky-800", running: "bg-violet-100 text-violet-800", succeeded: "bg-emerald-100 text-emerald-800", failed: "bg-red-100 text-red-800", cancelled: "bg-zinc-100 text-zinc-700" };

/** Pinterest test panel: environment, token, workers, queue pause/resume, read-only API tests, publish log. Never shows tokens. */
export function PinterestHealth({ kind }: { kind: WorkspaceKind }) {
  const [h, setH] = useState<Health | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pinterest/health?workspace=${kind}`);
    setH(await res.json().catch(() => ({ error: "Could not load the check." })));
  }, [kind]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pinterest/health?workspace=${kind}`)
      .then((r) => r.json())
      .then((b) => !cancelled && setH(b))
      .catch(() => !cancelled && setH({ error: "Could not load the check." } as Health));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function setPaused(paused: boolean) {
    setBusy("pause");
    const res = await fetch("/api/pinterest/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: kind, paused }) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) setTest({ ok: false, text: b.error ?? "Could not change the queue." });
    setBusy(null);
    await load();
  }
  async function runTest(which: "connection" | "boards") {
    setBusy(which);
    setTest(null);
    const res = await fetch("/api/pinterest/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: kind, test: which }) });
    const b = await res.json().catch(() => ({}));
    setTest(b.ok ? { ok: true, text: `Works (${b.ms} ms): ${b.detail}` } : { ok: false, text: b.error ?? "The test failed." });
    setBusy(null);
  }

  if (!h) return null;
  if (h.demo) return null;
  if (h.error) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{h.error}</p>;
  const btn = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50";

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm" aria-label="Pinterest check">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Publishing & check</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${h.config.env === "production" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>
          {h.config.env === "production" ? "PRODUCTION: pins are public" : "SANDBOX: test pins only you can see"}
        </span>
      </div>

      <ul className="grid gap-1 sm:grid-cols-2">
        <li>Server settings: <span className={h.config.ready ? TONE.ok : TONE.error}>{h.config.ready ? "complete" : `missing ${h.config.missing.length}`}</span></li>
        <li>Connection: {h.connection ? <span className={h.connection.status === "active" ? TONE.ok : TONE.error}>@{h.connection.username} ({h.connection.status === "active" ? "active" : "reconnect needed"})</span> : <span className={TONE.never}>not connected</span>}</li>
        {h.connection && <li>Scopes: <span className="font-mono text-xs">{h.connection.scopes.join(", ") || "none"}</span></li>}
        {h.token && h.connection && (
          <li>
            Login: <span className={TONE[h.token.login === "unknown" ? h.token.access : h.token.login]}>{h.token.login === "expiring" ? "expires soon, reconnect" : h.token.login === "expired" ? "expired, reconnect" : "valid"}</span>
            {h.connection.refresh_expires_at ? ` until ${when(h.connection.refresh_expires_at)}` : ""}
          </li>
        )}
        {h.workers ? (
          <>
            <li>Publish worker: <span className={TONE[h.workers.publish.state]}>{WORKER_TEXT[h.workers.publish.state]}</span> · last {when(h.workers.publish.last_run_at)}</li>
            <li>Autopilot worker: <span className={TONE[h.workers.autopilot.state]}>{WORKER_TEXT[h.workers.autopilot.state]}</span></li>
          </>
        ) : (
          <li className="text-zinc-500">Worker status needs database update 0016.</li>
        )}
        {h.queue && <li>Queue: {h.queue.queued} waiting · {h.queue.running} running · {h.queue.published7d} published / {h.queue.failed7d} failed (7 days)</li>}
      </ul>
      {h.lastError && <p className="rounded-md bg-red-50 p-2 text-xs text-red-800"><strong>Last error:</strong> {h.lastError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {h.pauseSupported &&
          (h.paused ? (
            <>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Queue paused: scheduled pins wait</span>
              <button disabled={busy !== null} onClick={() => setPaused(false)} className={`${btn} bg-zinc-900 text-white`}>Resume publishing</button>
            </>
          ) : (
            <button disabled={busy !== null} onClick={() => setPaused(true)} className={btn}>Pause publishing</button>
          ))}
        {h.connection && (
          <>
            <button disabled={busy !== null} onClick={() => runTest("connection")} className={btn}>{busy === "connection" ? "Testing…" : "Test connection"}</button>
            <button disabled={busy !== null} onClick={() => runTest("boards")} className={btn}>{busy === "boards" ? "Testing…" : "Test reading boards"}</button>
          </>
        )}
        <button disabled={busy !== null} onClick={load} className="text-sm underline">Refresh</button>
      </div>
      <p className="text-xs text-zinc-500">Tests only read from Pinterest; they never create a pin or board.</p>
      {test && <p className={`text-sm ${test.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{test.text}</p>}

      {h.jobs && h.jobs.length > 0 && (
        <div>
          <h3 className="font-medium">Publish log</h3>
          <ul className="mt-1 flex flex-col divide-y divide-zinc-100 text-xs">
            {h.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className={`rounded px-1.5 py-0.5 font-semibold ${JOB_TONE[j.status] ?? ""}`}>{j.status}</span>
                <span className="min-w-0 flex-1 truncate">{j.title}{j.board_name ? ` → ${j.board_name}` : ""}</span>
                <span className="text-zinc-500">{when(j.run_at)}{j.timezone ? ` (${j.timezone})` : ""} · try {j.attempts}</span>
                {j.external_pin_id && <a className="text-red-700 underline" href={`https://www.pinterest.com/pin/${j.external_pin_id}/`} target="_blank" rel="noreferrer">pin</a>}
                {j.last_error && j.status !== "succeeded" && <span className="basis-full text-red-700">{j.last_error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
