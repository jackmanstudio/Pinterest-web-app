"use client";
import { useCallback, useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";

interface ErrorRow {
  id: string;
  created_at: string;
  source: "server" | "client" | "api";
  route: string | null;
  method: string | null;
  status: number | null;
  message: string;
  digest: string | null;
  context: Record<string, unknown> | null;
}

const SOURCE_LABEL: Record<ErrorRow["source"], string> = { api: "Server (API)", server: "Server (page)", client: "Browser" };

function bugText(e: ErrorRow): string {
  const where = typeof e.context?.where === "string" ? e.context.where : null;
  return [
    `Error ID: ${e.id}`,
    `Time: ${new Date(e.created_at).toISOString()}`,
    `Where: ${SOURCE_LABEL[e.source]} ${e.method ?? ""} ${e.route ?? ""}`.trim(),
    e.status ? `Status: ${e.status}` : null,
    `Message: ${e.message}`,
    where ? `Code: ${where}` : null,
    e.digest ? `Digest: ${e.digest}` : null,
    e.context ? `Details: ${JSON.stringify(e.context)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Account page: the latest errors this user hit, each with an ID and the exact place it failed. */
export function ErrorLog() {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/errors", { cache: "no-store" });
      const data = (await res.json()) as { errors?: ErrorRow[]; note?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setErr(null);
      setRows(data.errors ?? []);
      setNote(data.note ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the error log");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <section id="errors" className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Error log</h2>
        <button onClick={() => void load()} className="rounded-md border border-zinc-300 px-3 py-1 text-sm">Refresh</button>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Every error you run into is recorded here automatically, on the server and in the browser, with an error ID and the place it failed. Copy one to report a bug.
      </p>
      {note ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p> : null}
      {err ? <p className="mt-3 text-sm text-red-700">{err}</p> : null}
      {rows === null ? (
        <p className="mt-3 text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 && !note && !err ? (
        <p className="mt-3 text-sm text-emerald-700">No errors recorded. 🎉</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {rows.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full flex-wrap items-baseline gap-x-2 text-left">
                <span className="font-mono text-xs text-zinc-500">{new Date(e.created_at).toLocaleString()}</span>
                <span className="rounded bg-zinc-100 px-1.5 text-xs">{SOURCE_LABEL[e.source]}</span>
                <span className="font-mono text-xs">{[e.method, e.route].filter(Boolean).join(" ")}</span>
                {e.status ? <span className="text-xs text-red-700">{e.status}</span> : null}
                <span className="min-w-0 basis-full break-words text-zinc-800">{e.message}</span>
              </button>
              {open === e.id ? (
                <div className="mt-2 space-y-2">
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-xs">{bugText(e)}</pre>
                  <CopyButton text={bugText(e)} label="Copy bug report" />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
