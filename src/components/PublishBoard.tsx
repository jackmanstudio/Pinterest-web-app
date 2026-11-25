"use client";
import { useCallback, useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import { STATUS_LABELS, WORKSPACE_LABELS, type AuditEvent, type DraftStatus, type PinDraft, type WorkspaceKind } from "@/lib/types";
import { publishBlockers } from "@/lib/workflow/checks";
import { recommendBoard } from "@/lib/publishing/boards";
import { ACTION_LABELS, type WorkflowAction } from "@/lib/workflow/transitions";
import { SourceBadge } from "./DraftEditor";
import { useWorkspace } from "./useWorkspace";

interface Board { board_id: string; name: string; description?: string | null }
interface PinterestInfo {
  ready: boolean;
  env: "sandbox" | "production";
  username: string | null;
  active: boolean;
  scopes: string[];
  boards: Board[];
}

const ORDER: DraftStatus[] = ["draft", "in_review", "approved", "scheduled", "published"];
const STATUS_TONE: Record<DraftStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  in_review: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-violet-100 text-violet-800",
  published: "bg-red-100 text-red-800",
};

function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishBoard({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const [drafts, setDrafts] = useState<PinDraft[] | null>(null);
  const [chosenTab, setTab] = useState<DraftStatus | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [pin, setPin] = useState<PinterestInfo>({ ready: false, env: "sandbox", username: null, active: false, scopes: [], boards: [] });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!store || !workspace) return;
    setDrafts(await store.listDrafts(workspace.id));
  }, [store, workspace]);

  useEffect(() => {
    if (!store || !workspace) return;
    let cancelled = false;
    store
      .listDrafts(workspace.id)
      .then((d) => !cancelled && setDrafts(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    fetch(`/api/pinterest/status?workspace=${kind}`)
      .then((r) => r.json())
      .then((s) => {
        if (cancelled || s.error) return;
        setPin({
          ready: Boolean(s.config?.ready),
          env: s.config?.env ?? "sandbox",
          username: s.connection?.username ?? null,
          active: s.connection?.status === "active",
          scopes: s.connection?.scopes ?? [],
          boards: (s.boards ?? []).map((b: Board) => ({ board_id: b.board_id, name: b.name, description: b.description ?? null })),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store, workspace, kind]);

  if (wsError) return <p className="text-red-700">Could not load workspace: {wsError}</p>;
  if (!store || !workspace || !drafts) return <p className="text-zinc-500">Loading…</p>;

  const live = drafts.filter((d) => !d.archived_at);
  const counts = Object.fromEntries(ORDER.map((s) => [s, live.filter((d) => d.status === s).length])) as Record<DraftStatus, number>;
  // Open on the step that needs attention first.
  const tab: DraftStatus = chosenTab ?? (["in_review", "approved", "draft", "scheduled", "published"] as DraftStatus[]).find((s) => counts[s] > 0) ?? "draft";
  const visible = live.filter((d) => d.status === tab);
  const bulkAction: WorkflowAction | null = tab === "draft" ? "submit" : tab === "in_review" ? "approve" : null;

  async function runBulk(action: WorkflowAction) {
    setError(null);
    let done = 0;
    const failed: string[] = [];
    for (const d of visible) {
      setBulk(`${ACTION_LABELS[action]}: ${done + 1} of ${visible.length}…`);
      try {
        await store!.transition(workspace!.id, d.id, action);
        done++;
      } catch (e) {
        failed.push(`“${d.title}”: ${(e as Error).message}`);
      }
    }
    setBulk(null);
    await reload();
    if (failed.length) setError(`${done} done, ${failed.length} failed. ${failed.slice(0, 3).join(" ")}`);
    else setTab(action === "submit" ? "in_review" : "approved");
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{WORKSPACE_LABELS[kind]} · Review & publish</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Draft → In review → Approved → Scheduled → Published. Nothing goes to Pinterest without an approval <em>and</em> a second confirmation.
        </p>
      </div>
      {store.mode === "demo" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Demo mode: you can try review and approval here (saved in this browser). Scheduling and publishing are disabled until Supabase and a Pinterest
          account are connected.
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      <nav className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1" aria-label="Status">
        {ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${tab === s ? "bg-white shadow-sm" : "text-zinc-600"}`}
          >
            {STATUS_LABELS[s]}
            <span className={`rounded-full px-1.5 text-xs ${STATUS_TONE[s]}`}>{counts[s]}</span>
          </button>
        ))}
      </nav>

      {bulkAction && visible.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => runBulk(bulkAction)}
            disabled={Boolean(bulk)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {bulkAction === "approve" ? `Approve all ${visible.length}` : `Send all ${visible.length} for review`}
          </button>
          <span className="text-xs text-zinc-600">{bulk ?? "Or review each pin below."}</span>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-600">No pins are {STATUS_LABELS[tab].toLowerCase()}.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => (
            <PinCard key={d.id} kind={kind} store={store} draft={d} pin={pin} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function PinCard({ kind, store, draft, pin, onChanged }: { kind: WorkspaceKind; store: Store; draft: PinDraft; pin: PinterestInfo; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<WorkflowAction | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState(draft.link ?? "");
  const [boardId, setBoardId] = useState(draft.board_id ?? "");
  const [runAt, setRunAt] = useState(() => localInputValue(new Date(Date.now() + 60 * 60_000)));
  const [log, setLog] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.imageUrl(draft).then((u) => !cancelled && setUrl(u)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store, draft]);

  const board = pin.boards.find((b) => b.board_id === boardId);
  const suggested = recommendBoard(pin.boards, { title: draft.title, tags: draft.tags, category: draft.idea });
  const blockers =
    draft.status === "approved"
      ? store.mode === "demo"
        ? ["Publishing needs Supabase and a connected Pinterest account."]
        : !pin.ready
          ? ["Pinterest isn't configured on the server."]
          : publishBlockers({ ...draft, link: link || null }, { connected: Boolean(pin.username), connectionActive: pin.active, grantedScopes: pin.scopes, boardId: boardId || null })
      : [];

  async function act(action: WorkflowAction) {
    setBusy(true);
    setMsg(null);
    try {
      await store.transition(draft.workspace_id, draft.id, action, {
        note: action === "request_changes" ? note || undefined : undefined,
        boardId: boardId || undefined,
        boardName: board?.name,
        runAt: action === "schedule" ? new Date(runAt).toISOString() : undefined,
      });
      setConfirming(null);
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function saveLink() {
    try {
      await store.updateDraft(draft.workspace_id, draft.id, { link: link.trim() || null });
      setMsg({ ok: true, text: "Link saved." });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function toggleLog() {
    if (log) return setLog(null);
    setLog(await store.audit(draft.workspace_id, draft.id));
  }

  const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
  const where = `${pin.username ? `@${pin.username}` : "the connected account"}${board ? ` → board “${board.name}”` : ""} (${pin.env === "sandbox" ? "Sandbox: only you can see it" : "Production: public"})`;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed/data URL
          <img src={url} alt={draft.alt_text} className="aspect-[2/3] w-20 flex-none rounded object-cover" />
        ) : (
          <div className="flex aspect-[2/3] w-20 flex-none items-center justify-center rounded bg-zinc-100 text-center text-[10px] text-zinc-500">No image</div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className={`self-start rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_TONE[draft.status]}`}>{STATUS_LABELS[draft.status]}</span>
          <p className="font-medium leading-snug">{draft.title}</p>
          <p className="text-xs text-zinc-500">{draft.angle}</p>
          <div className="flex flex-wrap gap-1">
            <SourceBadge source={draft.source} />
            {draft.image_source && <SourceBadge source={draft.image_source} what="image" />}
          </div>
        </div>
      </div>

      {draft.review_note && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"><strong>Note:</strong> {draft.review_note}</p>}

      {draft.status === "draft" && (
        <button disabled={busy} onClick={() => act("submit")} className={`${btn} self-start bg-zinc-900 text-white`}>{ACTION_LABELS.submit}</button>
      )}

      {draft.status === "in_review" && confirming !== "request_changes" && (
        <div className="flex flex-wrap gap-2">
          {confirming === "approve" ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              Approve this pin for publishing?
              <button disabled={busy} onClick={() => act("approve")} className={`${btn} bg-emerald-700 text-white`}>Yes, approve</button>
              <button onClick={() => setConfirming(null)} className="text-sm underline">Cancel</button>
            </span>
          ) : (
            <>
              <button disabled={busy} onClick={() => setConfirming("approve")} className={`${btn} bg-emerald-700 text-white`}>{ACTION_LABELS.approve}</button>
              <button disabled={busy} onClick={() => setConfirming("request_changes")} className={`${btn} border border-zinc-300`}>{ACTION_LABELS.request_changes}</button>
            </>
          )}
        </div>
      )}
      {draft.status === "in_review" && confirming === "request_changes" && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium" htmlFor={`note-${draft.id}`}>What should change?</label>
          <textarea id={`note-${draft.id}`} rows={2} maxLength={500} className="rounded-md border border-zinc-300 p-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => act("request_changes")} className={`${btn} bg-zinc-900 text-white`}>Send back to draft</button>
            <button onClick={() => setConfirming(null)} className="text-sm underline">Cancel</button>
          </div>
        </div>
      )}

      {draft.status === "approved" && (
        <div className="flex flex-col gap-2 text-sm">
          <label className="text-xs font-medium" htmlFor={`link-${draft.id}`}>Destination link (optional)</label>
          <div className="flex gap-2">
            <input id={`link-${draft.id}`} className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
            {link !== (draft.link ?? "") && <button onClick={saveLink} className={`${btn} border border-zinc-300`}>Save</button>}
          </div>
          {link !== (draft.link ?? "") && <p className="text-xs text-zinc-500">Saving an edit withdraws approval, so it goes back to Draft.</p>}
          <label className="text-xs font-medium" htmlFor={`board-${draft.id}`}>Board</label>
          <select id={`board-${draft.id}`} className="rounded-md border border-zinc-300 px-2 py-1" value={boardId} onChange={(e) => setBoardId(e.target.value)} disabled={pin.boards.length === 0}>
            <option value="">{pin.boards.length ? "Choose a board…" : "No boards synced"}</option>
            {pin.boards.map((b) => (
              <option key={b.board_id} value={b.board_id}>{b.name}{suggested?.board.board_id === b.board_id ? " (suggested)" : ""}</option>
            ))}
          </select>
          {suggested && suggested.board.board_id !== boardId && (
            <p className="text-xs text-zinc-600">
              Suggested: <strong>{suggested.board.name}</strong> ({suggested.reason}).{" "}
              <button className="underline" onClick={() => setBoardId(suggested.board.board_id)}>Use it</button>
            </p>
          )}
          {blockers.length > 0 && (
            <ul className="list-disc rounded-md bg-zinc-50 p-2 pl-6 text-xs text-zinc-700">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {confirming === "publish_now" || confirming === "schedule" ? (
            <div className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-3">
              <p className="text-sm text-red-900">
                {confirming === "publish_now" ? "This creates a LIVE pin now on " : "This will create a LIVE pin at the time below on "}
                {where}. Continue?
              </p>
              {confirming === "schedule" && (
                <input type="datetime-local" aria-label="Publish at" className="rounded-md border border-zinc-300 px-2 py-1" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
              )}
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => act(confirming)} className={`${btn} bg-red-700 text-white`}>
                  {busy ? "Working…" : confirming === "publish_now" ? "Yes, publish now" : "Yes, schedule"}
                </button>
                <button onClick={() => setConfirming(null)} className="text-sm underline">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button disabled={busy || blockers.length > 0} onClick={() => setConfirming("publish_now")} className={`${btn} bg-red-700 text-white`}>{ACTION_LABELS.publish_now}</button>
              <button disabled={busy || blockers.length > 0} onClick={() => setConfirming("schedule")} className={`${btn} border border-zinc-300`}>{ACTION_LABELS.schedule}…</button>
              <button disabled={busy} onClick={() => act("unapprove")} className="text-sm text-zinc-600 underline">{ACTION_LABELS.unapprove}</button>
            </div>
          )}
        </div>
      )}

      {draft.status === "scheduled" && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Publishes {draft.scheduled_for ? new Date(draft.scheduled_for).toLocaleString() : "soon"}
            {draft.board_name ? ` to “${draft.board_name}”` : ""}.
          </p>
          <button disabled={busy} onClick={() => act("cancel_schedule")} className={`${btn} self-start border border-zinc-300`}>{ACTION_LABELS.cancel_schedule}</button>
        </div>
      )}

      {draft.status === "published" && draft.external_pin_id && (
        <p className="text-sm">
          Live on Pinterest{draft.board_name ? ` in “${draft.board_name}”` : ""} ·{" "}
          <a className="font-medium text-red-700 underline" href={`https://www.pinterest.com/pin/${draft.external_pin_id}/`} target="_blank" rel="noreferrer">
            Pin {draft.external_pin_id}
          </a>
          {draft.published_at ? ` · ${new Date(draft.published_at).toLocaleString()}` : ""}
        </p>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{msg.text}</p>}

      <button onClick={toggleLog} className="self-start text-xs text-zinc-500 underline">{log ? "Hide activity" : "Show activity"}</button>
      {log && (
        <ul className="flex flex-col gap-1 border-t border-zinc-100 pt-2 text-xs text-zinc-600">
          {log.length === 0 && <li>No activity yet.</li>}
          {log.map((e) => (
            <li key={e.id}>
              {new Date(e.created_at).toLocaleString()} · <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
              {typeof e.details.note === "string" ? ` — “${e.details.note}”` : ""}
              {typeof e.details.pin_id === "string" ? ` — pin ${e.details.pin_id}` : ""}
              {typeof e.details.error === "string" ? ` — ${e.details.error}` : ""}
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">{kind}</span>
    </article>
  );
}
