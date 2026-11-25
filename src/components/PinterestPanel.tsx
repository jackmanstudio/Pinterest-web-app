"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionInfo } from "@/lib/pinterest/connections";
import { WORKSPACE_LABELS, type WorkspaceKind } from "@/lib/types";

interface Board { board_id: string; name: string; privacy: string | null; pin_count: number | null }
interface Pin { pin_id: string; title: string | null; description: string | null; link: string | null; alt_text: string | null; image_url: string | null; pin_created_at: string | null }
interface StatusData {
  config: { ready: boolean; missing: string[]; env: "sandbox" | "production" };
  connection: ConnectionInfo | null;
  boards: Board[];
  pins: Pin[];
  pin_total?: number;
  error?: string;
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "never");

export function PinterestPanel({ kind }: { kind: WorkspaceKind }) {
  const params = useSearchParams();
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(params.get("connected") ? "Pinterest connected. Run a sync to load your boards and pins." : null);
  const [busy, setBusy] = useState<"idle" | "sync" | "disconnect">("idle");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/pinterest/status?workspace=${kind}`);
    const body = (await r.json()) as StatusData;
    if (!r.ok) setError(body.error ?? "Could not load Pinterest status");
    else setData(body);
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pinterest/status?workspace=${kind}`)
      .then(async (r) => {
        const body = (await r.json()) as StatusData;
        if (cancelled) return;
        if (!r.ok) setError(body.error ?? "Could not load Pinterest status");
        else setData(body);
      })
      .catch(() => !cancelled && setError("Could not reach the server."));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function post(path: string) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: kind }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? "Request failed");
    return body;
  }

  async function sync() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const r = await post("/api/pinterest/sync");
      setNotice(`Synced ${r.boards} boards and ${r.pins} pins${r.truncated ? " (stopped at the page limit; older items not loaded)" : ""}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("idle");
      await load();
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError(null);
    try {
      await post("/api/pinterest/disconnect");
      setNotice("Disconnected. Stored tokens and synced copies were removed. Nothing on Pinterest was changed.");
      setConfirmDisconnect(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("idle");
      await load();
    }
  }

  const label = WORKSPACE_LABELS[kind];
  const conn = data?.connection;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold">{label} · Pinterest account</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Each workspace connects its own Pinterest account. This app only <strong>reads</strong> boards and pins for now; it never publishes,
          edits or deletes anything on Pinterest.
        </p>

        {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{notice}</p>}

        {!data && !error && <p className="mt-3 text-sm text-zinc-500">Loading…</p>}

        {data && !data.config.ready && (
          <div className="mt-4 rounded-md border border-zinc-300 bg-zinc-50 p-4 text-sm">
            <p className="font-medium">Pinterest isn&apos;t set up on the server yet.</p>
            <p className="mt-1 text-zinc-600">These server settings are missing:</p>
            <ul className="mt-2 list-disc pl-5 font-mono text-xs">
              {data.config.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="mt-2 text-zinc-600">See “Connect Pinterest” in the README for the developer-portal steps.</p>
          </div>
        )}

        {data?.config.ready && !conn && (
          <div className="mt-4 flex flex-col gap-2">
            <a href={`/api/pinterest/connect?workspace=${kind}`} className="self-start rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white">
              Connect a Pinterest account to {label}
            </a>
            <p className="text-xs text-zinc-500">
              Environment: {data.config.env === "sandbox" ? "Sandbox (Trial access: only you can see test content)" : "Production"}
            </p>
          </div>
        )}

        {conn && (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- remote Pinterest avatar */}
              {conn.profile_image && <img src={conn.profile_image} alt="" className="h-10 w-10 rounded-full" />}
              <div>
                <p className="font-medium">@{conn.username}</p>
                <p className="text-xs text-zinc-600">
                  {conn.account_type ?? "account"} · {conn.environment === "sandbox" ? "Sandbox" : "Production"} · connected {when(conn.connected_at)}
                </p>
              </div>
              <span className={`ml-auto rounded px-2 py-0.5 text-xs font-semibold ${conn.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {conn.status === "active" ? "Connected" : "Reconnect needed"}
              </span>
            </div>
            <p><span className="font-medium">Granted scopes:</span> {conn.scopes.join(", ") || "none reported"}</p>
            <p>
              <span className="font-medium">Access token expires:</span> {when(conn.access_expires_at)} (refreshed automatically)
              {conn.refresh_expires_at && <> · <span className="font-medium">login valid until:</span> {when(conn.refresh_expires_at)}</>}
            </p>
            <p>
              <span className="font-medium">Last sync:</span> {when(conn.last_synced_at)} ·{" "}
              <span className={conn.sync_status === "error" ? "text-red-700" : ""}>{conn.sync_status}</span>
              {conn.sync_error && <span className="text-red-700"> ({conn.sync_error})</span>}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {conn.status === "active" ? (
                <button onClick={sync} disabled={busy !== "idle"} className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50">
                  {busy === "sync" ? "Syncing…" : "Sync boards & pins"}
                </button>
              ) : (
                <a href={`/api/pinterest/connect?workspace=${kind}`} className="rounded-md bg-red-700 px-4 py-2 font-medium text-white">Reconnect</a>
              )}
              {!confirmDisconnect ? (
                <button onClick={() => setConfirmDisconnect(true)} className="text-red-700 hover:underline">Disconnect…</button>
              ) : (
                <span className="flex items-center gap-2">
                  Remove the stored login and synced copies for {label}?
                  <button onClick={disconnect} disabled={busy !== "idle"} className="rounded-md bg-red-700 px-3 py-1 text-white">Yes, disconnect</button>
                  <button onClick={() => setConfirmDisconnect(false)} className="underline">Cancel</button>
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {conn && data && (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Boards ({data.boards.length})</h2>
            {data.boards.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">No boards synced yet.</p>
            ) : (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.boards.map((b) => (
                  <li key={b.board_id} className="rounded-md border border-zinc-200 p-3 text-sm">
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-zinc-500">{b.privacy ?? ""}{b.pin_count != null ? ` · ${b.pin_count} pins` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Pins ({data.pin_total ?? data.pins.length}){(data.pin_total ?? 0) > data.pins.length ? ` · showing latest ${data.pins.length}` : ""}</h2>
            {data.pins.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">No pins synced yet.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {data.pins.map((p) => (
                  <li key={p.pin_id} className="flex flex-col gap-1 text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Pinterest CDN image */}
                    {p.image_url && <img src={p.image_url} alt={p.alt_text ?? p.title ?? ""} className="aspect-[2/3] w-full rounded object-cover" />}
                    <p className="font-medium">{p.title || "(untitled)"}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
