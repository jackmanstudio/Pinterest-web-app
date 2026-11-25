"use client";
import { PageTitle } from "./PageTitle";
import { useCallback, useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import { STATUS_LABELS, type AuditEvent, type DraftStatus, type PinDraft, type WorkspaceKind } from "@/lib/types";
import { publishBlockers } from "@/lib/workflow/checks";
import { recommendBoard } from "@/lib/publishing/boards";
import { boardChecks, METHOD_LABELS, type BoardPlan } from "@/lib/boards/automation";
import { draftFacts, loadBoardSource } from "@/lib/client/boards";
import { ACTION_LABELS, type WorkflowAction } from "@/lib/workflow/transitions";
import { spreadTimes } from "@/lib/planning/spread";
import { SourceBadge } from "./DraftEditor";
import { useWorkspace } from "./useWorkspace";

interface Board { board_id: string; name: string; description?: string | null; privacy?: string | null }
interface PinterestInfo {
  /** Demo sample boards (no real boards synced yet). */
  sample: boolean;
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
  const [pin, setPin] = useState<PinterestInfo>({ sample: true, ready: false, env: "sandbox", username: null, active: false, scopes: [], boards: [] });
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Map<string, BoardPlan>>(new Map());

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
    loadBoardSource(kind).then((b) => {
      if (cancelled) return;
      setPin({ sample: b.sample, ready: b.ready, env: b.env, username: b.username, active: b.active, scopes: b.scopes, boards: b.boards });
    });
    store
      .listBoardPlans(workspace.id)
      .then((p) => !cancelled && setPlans(new Map(p.map((x) => [x.draft_id, x]))))
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
      <PageTitle
        kind={kind}
        title="Review &"
        accent="publish"
        sub={<>Draft → In review → Approved → Scheduled → Published. Nothing goes to Pinterest without an approval <em>and</em> a second confirmation.</>}
      />
      {store.mode === "demo" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Demo mode: you can try review and approval here (saved in this browser). Scheduling and publishing are disabled until Supabase and a Pinterest
          account are connected.
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" role="tablist" aria-label="Pins by status">
        {ORDER.map((s) => {
          const active = tab === s;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(s)}
              className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a45] ${active ? "border-[#ff7a45]/60 bg-gradient-to-br from-[#e60023]/25 to-[#ff7a45]/10 shadow-[0_14px_40px_-18px_rgba(255,90,60,0.8)]" : "border-white/10 bg-white/[0.05] hover:border-white/25 hover:bg-white/[0.09]"}`}
            >
              <span className="flex items-center gap-2 text-[13px] font-medium text-white/70 group-hover:text-white">
                <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                {STATUS_LABELS[s]}
              </span>
              <span className="mt-2 block text-3xl font-bold leading-none tabular-nums text-white">{counts[s]}</span>
              {active && <span aria-hidden className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-[#e60023] to-[#ff9a5a]" />}
            </button>
          );
        })}
      </div>

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

      {tab === "approved" && visible.length > 1 && (
        <SpreadSchedule
          store={store}
          drafts={visible}
          scheduled={live.filter((d) => d.status === "scheduled" && d.scheduled_for).map((d) => new Date(d.scheduled_for!))}
          pin={pin}
          plans={plans}
          demo={store.mode === "demo"}
          onDone={reload}
        />
      )}

      {visible.length === 0 ? (
        <p className="au-glass rounded-2xl p-6 text-center text-sm text-white/60">No pins are {STATUS_LABELS[tab].toLowerCase()} right now.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => (
            <PinCard key={d.id} kind={kind} store={store} draft={d} pin={pin} plan={plans.get(d.id) ?? null} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_DOT: Record<DraftStatus, string> = {
  draft: "bg-white/60",
  in_review: "bg-amber-300",
  approved: "bg-sky-400",
  scheduled: "bg-violet-400",
  published: "bg-emerald-400",
};

function PinCard({ kind, store, draft, pin, plan, onChanged }: { kind: WorkspaceKind; store: Store; draft: PinDraft; pin: PinterestInfo; plan: BoardPlan | null; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<WorkflowAction | null>(null);
  const [note, setNote] = useState("");
  const [link, setLink] = useState(draft.link ?? "");
  const [chosenBoard, setBoardId] = useState<string | null>(null);
  // The planned board (Boards page / Automatic mode) is used unless you pick another one.
  const boardId = chosenBoard ?? draft.board_id ?? (plan && pin.boards.some((b) => b.board_id === plan.board_id) ? plan.board_id : "");
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
  const checks = boardChecks(boardId || null, pin.boards, { connectedUsername: pin.username, demo: pin.sample, facts: draftFacts(draft), plan: plan && plan.board_id === boardId ? plan : chosenBoard ? { board_id: chosenBoard, method: "custom", confidence: null } : null });
  const boardProblems = checks.filter((c) => !c.ok && (c.id === "valid" || c.id === "owned")).map((c) => c.label);
  const blockers =
    draft.status === "approved"
      ? store.mode === "demo"
        ? ["Publishing needs Supabase and a connected Pinterest account."]
        : !pin.ready
          ? ["Pinterest isn't configured on the server."]
          : [...publishBlockers({ ...draft, link: link || null }, { connected: Boolean(pin.username), connectionActive: pin.active, grantedScopes: pin.scopes, boardId: boardId || null }), ...boardProblems]
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
          {pin.sample && <p className="text-xs text-amber-800">Demo sample boards. Connect Pinterest and sync to see your real boards.</p>}
          {plan && plan.board_id === boardId && (
            <p className="text-xs text-zinc-600">
              {METHOD_LABELS[plan.method]}
              {plan.category ? ` · ${plan.category}` : ""}
              {plan.reason ? ` · ${plan.reason}` : ""}
            </p>
          )}
          {boardId && (
            <ul className="flex flex-col gap-0.5 text-xs" aria-label="Board checks">
              {checks.map((c) => (
                <li key={c.id} className={c.ok ? "text-emerald-700" : "text-amber-800"}>{c.ok ? "✓" : "⚠"} {c.label}</li>
              ))}
            </ul>
          )}
          {!plan && suggested && suggested.board.board_id !== boardId && (
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

/**
 * Schedules several approved pins at once, a few per day inside a posting
 * window, evenly spaced and away from pins already scheduled. Each pin goes
 * to the board planned for it; pins without a valid board are left alone.
 */
function SpreadSchedule({ store, drafts, scheduled, pin, plans, demo, onDone }: {
  store: Store; drafts: PinDraft[]; scheduled: Date[]; pin: PinterestInfo; plans: Map<string, BoardPlan>; demo: boolean; onDone: () => Promise<void>;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [perDay, setPerDay] = useState(3);
  const [fromHour, setFrom] = useState(12);
  const [toHour, setTo] = useState(23);
  const [gap, setGap] = useState(60);
  const [startDay, setStartDay] = useState(() => localInputValue(new Date(Date.now() + 30 * 60_000)).slice(0, 10));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const boardIds = new Set(pin.boards.map((b) => b.board_id));
  const ready = drafts.filter((d) => {
    const plan = plans.get(d.id);
    // Without a live account, show the spacing plan anyway; scheduling stays off below.
    return plan?.board_id && boardIds.has(plan.board_id) && (demo || !pin.ready || publishBlockers(d, { connected: Boolean(pin.username), connectionActive: pin.active, grantedScopes: pin.scopes, boardId: plan.board_id }).length === 0);
  });
  const skipped = drafts.length - ready.length;
  const earliest = Math.max(now + 15 * 60_000, new Date(`${startDay}T00:00`).getTime() || 0);
  const times = spreadTimes(ready.length, { start: new Date(earliest), perDay, fromHour, toHour, timeZone, minGapMinutes: gap, existing: scheduled });
  const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const blocked = demo ? "Scheduling needs Supabase and a connected Pinterest account." : !pin.ready ? "Pinterest isn't configured on the server." : null;

  async function run() {
    setResult(null);
    let done = 0;
    const failed: string[] = [];
    for (const [i, d] of ready.entries()) {
      const plan = plans.get(d.id)!;
      setBusy(`Scheduling ${i + 1} of ${ready.length}…`);
      try {
        await store.transition(d.workspace_id, d.id, "schedule", { boardId: plan.board_id!, boardName: plan.board_name ?? undefined, runAt: times[i].toISOString() });
        done++;
      } catch (e) {
        failed.push(`“${d.title}”: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    setConfirm(false);
    setResult(failed.length ? { ok: false, text: `${done} scheduled, ${failed.length} failed. ${failed.slice(0, 3).join(" ")}` } : { ok: true, text: `${done} pins scheduled. See them in the Scheduled tab.` });
    await onDone();
  }

  const num = "w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm";
  if (!open) {
    return (
      <button onClick={() => { setNow(Date.now()); setOpen(true); }} className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
        Schedule several pins, spaced out…
      </button>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" aria-label="Spread schedule">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Schedule several pins, spaced out</h2>
          <p className="text-xs text-zinc-600">A few pins a day inside your window, evenly spaced and away from pins already scheduled. Times are in {timeZone}.</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-sm underline">Close</button>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs font-medium text-zinc-700">
        <label className="flex flex-col gap-1">Start day<input type="date" className="rounded-md border border-zinc-300 px-2 py-1 text-sm" value={startDay} onChange={(e) => setStartDay(e.target.value)} /></label>
        <label className="flex flex-col gap-1">Pins per day<input type="number" min={1} max={25} className={num} value={perDay} onChange={(e) => setPerDay(Number(e.target.value) || 1)} /></label>
        <label className="flex flex-col gap-1">From hour<input type="number" min={0} max={23} className={num} value={fromHour} onChange={(e) => setFrom(Number(e.target.value))} /></label>
        <label className="flex flex-col gap-1">To hour<input type="number" min={1} max={24} className={num} value={toHour} onChange={(e) => setTo(Number(e.target.value))} /></label>
        <label className="flex flex-col gap-1">Min. gap (minutes)<input type="number" min={0} max={720} step={15} className={num} value={gap} onChange={(e) => setGap(Number(e.target.value) || 0)} /></label>
      </div>
      {skipped > 0 && (
        <p className="text-xs text-amber-800">{skipped} approved pin{skipped === 1 ? " is" : "s are"} left out: no planned board yet, or something below needs fixing. Open each pin to finish it.</p>
      )}
      {ready.length > 0 && (
        <ol className="max-h-56 overflow-y-auto rounded-md bg-zinc-50 p-2 text-xs">
          {ready.map((d, i) => (
            <li key={d.id} className="flex justify-between gap-3 py-0.5">
              <span className="truncate">{d.title} <span className="text-zinc-500">→ {plans.get(d.id)?.board_name}</span></span>
              <span className="flex-none font-medium">{times[i] ? fmt(times[i]) : "no slot"}</span>
            </li>
          ))}
        </ol>
      )}
      {blocked ? (
        <p className="text-xs text-zinc-600">{blocked} The plan above shows how the pins would be spaced.</p>
      ) : ready.length === 0 ? null : !confirm ? (
        <button onClick={() => { setNow(Date.now()); setConfirm(true); }} disabled={Boolean(busy) || times.length < ready.length} className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          Schedule {ready.length} pins…
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-3">
          <p className="text-sm text-red-900">
            This will create {ready.length} LIVE pins on {pin.username ? `@${pin.username}` : "the connected account"} at the times above
            ({pin.env === "sandbox" ? "Sandbox: only you can see them" : "Production: public"}). You can cancel any of them from the Scheduled tab before its time. Continue?
          </p>
          <div className="flex gap-2">
            <button disabled={Boolean(busy)} onClick={run} className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ?? "Yes, schedule them"}</button>
            <button onClick={() => setConfirm(false)} className="text-sm underline">Cancel</button>
          </div>
        </div>
      )}
      {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.text}</p>}
    </section>
  );
}
