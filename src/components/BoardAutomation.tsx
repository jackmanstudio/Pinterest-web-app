"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BOARD_MODES,
  BOARD_MODE_LABELS,
  DEFAULT_BOARD_SETTINGS,
  MAX_BULK_KEYWORDS,
  METHOD_LABELS,
  boardChecks,
  boardNameKey,
  findBoardByName,
  groupByBoard,
  parseKeywords,
  type Assignment,
  type Board,
  type BoardPlan,
  type BoardSettings,
  type NewBoardSuggestion,
  type PlanMethod,
} from "@/lib/boards/automation";
import { draftFacts, loadBoardSource, requestAssignments, toPlan, type BoardSource } from "@/lib/client/boards";
import { toCsv } from "@/lib/tools/csv";
import { downloadFile } from "@/lib/client/download";
import { WORKSPACE_LABELS, type PinDraft, type WorkspaceKind } from "@/lib/types";
import { useWorkspace } from "./useWorkspace";

/** One editable row: a pin or a bulk keyword with its board. */
interface Row {
  key: string;
  label: string;
  keyword: string;
  category: string;
  board_id: string | null;
  board_name: string | null;
  method: PlanMethod;
  confidence: number | null;
  reason: string;
  new_board: NewBoardSuggestion | null;
  saved?: boolean;
}

const fromAssignment = (a: Assignment, label: string, keyword: string): Row => ({ ...a, label, keyword });
const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const card = "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm";

export function BoardAutomation({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const [src, setSrc] = useState<BoardSource | null>(null);
  const [settings, setSettings] = useState<BoardSettings>(DEFAULT_BOARD_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<string>("");
  const [drafts, setDrafts] = useState<PinDraft[] | null>(null);
  const [pinRows, setPinRows] = useState<Row[]>([]);
  const [kwText, setKwText] = useState("");
  const [kwRows, setKwRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, bs, ds, plans] = await Promise.all([loadBoardSource(kind), store.getBoardSettings(workspace.id), store.listDrafts(workspace.id), store.listBoardPlans(workspace.id)]);
        if (cancelled) return;
        setSrc(s);
        setSettings(bs);
        setSavedSettings(JSON.stringify(bs));
        setDrafts(ds);
        const byDraft = new Map(plans.map((p) => [p.draft_id, p]));
        setPinRows(
          eligible(ds).map((d) => {
            const p = byDraft.get(d.id);
            return {
              key: d.id, label: d.title, keyword: d.idea, category: p?.category ?? "", board_id: p?.board_id ?? null, board_name: p?.board_name ?? null,
              method: p?.method ?? "custom", confidence: p?.confidence ?? null, reason: p?.reason ?? "", new_board: null, saved: Boolean(p),
            };
          }),
        );
        setKwRows(
          bs.keyword_plan.map((k, i) => ({ key: `kw-${i}`, label: k.keyword, keyword: k.keyword, category: k.category, board_id: k.board_id, board_name: k.board_name, method: "plan", confidence: null, reason: "Saved bulk plan", new_board: null, saved: true })),
        );
      } catch (e) {
        if (!cancelled) setMsg({ ok: false, text: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, workspace, kind]);

  const boards = src?.boards ?? [];
  const settingsDirty = JSON.stringify(settings) !== savedSettings;

  if (wsError) return <p className="text-red-700">Could not load workspace: {wsError}</p>;
  if (!store || !workspace || !src || !drafts) return <p className="text-zinc-500">Loading…</p>;

  async function saveSettings(next = settings) {
    setMsg(null);
    try {
      await store!.saveBoardSettings(workspace!.id, next);
      setSavedSettings(JSON.stringify(next));
      setMsg({ ok: true, text: "Board settings saved." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function assignPins(onlyUnplanned: boolean) {
    const targets = eligible(drafts!).filter((d) => !onlyUnplanned || !pinRows.find((r) => r.key === d.id)?.saved);
    if (!targets.length) return setMsg({ ok: true, text: "Every pin already has a board. Use “Re-check all pins” to pick again." });
    setBusy(`Reading ${targets.length} pin${targets.length === 1 ? "" : "s"} and picking boards…`);
    setMsg(null);
    try {
      const r = await requestAssignments(kind, targets.map(draftFacts), settings);
      setNote(r.note);
      const byKey = new Map(r.assignments.map((a) => [a.key, a]));
      let rows = pinRows.map((row) => (byKey.has(row.key) ? { ...fromAssignment(byKey.get(row.key)!, row.label, row.keyword), saved: false } : row));
      // Custom mode: AI only suggests; the user saves. Other modes save the plan straight away (it's only a plan).
      if (settings.mode !== "custom") {
        const plans = r.assignments.map(toPlan).filter((p): p is BoardPlan => p !== null);
        await store!.saveBoardPlans(workspace!.id, plans);
        const savedKeys = new Set(plans.map((p) => p.draft_id));
        rows = rows.map((row) => (savedKeys.has(row.key) ? { ...row, saved: true } : row));
        setMsg({ ok: true, text: `Planned a board for ${plans.length} of ${targets.length} pins. Change any board below.` });
      } else {
        setMsg({ ok: true, text: "Suggestions ready. Choose or change the board for each pin, then save." });
      }
      setPinRows(rows);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function savePinRows() {
    const plans: BoardPlan[] = pinRows
      .filter((r) => !r.saved && r.board_id)
      .map((r) => ({ draft_id: r.key, board_id: r.board_id!, board_name: r.board_name!, category: r.category || null, reason: r.reason || null, method: r.method, confidence: r.confidence }));
    try {
      await store!.saveBoardPlans(workspace!.id, plans);
      setPinRows((rows) => rows.map((r) => (r.board_id ? { ...r, saved: true } : r)));
      setMsg({ ok: true, text: `Saved boards for ${plans.length} pin${plans.length === 1 ? "" : "s"}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function runBulk() {
    const { keywords, dropped } = parseKeywords(kwText);
    if (!keywords.length) return setMsg({ ok: false, text: "Type at least one keyword." });
    setBusy(`Categorising ${keywords.length} keyword${keywords.length === 1 ? "" : "s"}…`);
    setMsg(null);
    try {
      const r = await requestAssignments(kind, keywords.map((k, i) => ({ key: `kw-${i}`, keyword: k })), { ...settings, keyword_plan: [] });
      setNote(r.note);
      setKwRows(r.assignments.map((a, i) => fromAssignment(a, keywords[i], keywords[i])));
      setMsg({ ok: true, text: `${keywords.length} keywords sorted into boards.${dropped ? ` ${dropped} extra keywords were left out (max ${MAX_BULK_KEYWORDS}).` : ""} Review, then save the plan.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function saveBulkPlan() {
    const next = { ...settings, keyword_plan: kwRows.map((r) => ({ keyword: r.keyword, category: r.category, board_id: r.board_id, board_name: r.board_name })) };
    setSettings(next);
    await saveSettings(next);
    setKwRows((rows) => rows.map((r) => ({ ...r, saved: true })));
  }

  function onBoardCreated(b: Board, suggestion: string) {
    setSrc((s) => s && { ...s, boards: [...s.boards, b].sort((x, y) => x.name.localeCompare(y.name)) });
    const apply = (rows: Row[]) =>
      rows.map((r) => (r.new_board && boardNameKey(r.new_board.name) === suggestion ? { ...r, board_id: b.board_id, board_name: b.name, method: "custom" as const, new_board: null, saved: false } : r));
    setPinRows(apply);
    setKwRows(apply);
    setMsg({ ok: true, text: `Board “${b.name}” created on Pinterest. Pins that suggested it now use it; save to keep.` });
  }

  const suggestions = uniqueSuggestions([...pinRows, ...kwRows], boards);
  const unsavedPins = pinRows.filter((r) => !r.saved && r.board_id).length;
  const facts = new Map(drafts.map((d) => [d.id, draftFacts(d)]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{WORKSPACE_LABELS[kind]} · Boards & categories</h1>
        <p className="mt-1 text-sm text-zinc-600">
          AI reads each pin (keyword, title, description, tags and image description) and picks its category and the best board on your account. Nothing is
          posted or created on Pinterest from here without your OK.
        </p>
      </div>

      {src.sample ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Demo sample boards: no Pinterest boards are connected yet, so these {boards.length} example boards are used to show how it works.{" "}
          <Link className="underline" href={`/w/${kind}/pinterest`}>Connect Pinterest and sync boards</Link> to use your real boards.
        </p>
      ) : (
        <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
          {boards.length} boards from {src.username ? `@${src.username}` : "your Pinterest account"}.{" "}
          <Link className="underline" href={`/w/${kind}/pinterest`}>Sync again</Link> after you add boards on Pinterest.
        </p>
      )}
      {msg && <p className={`rounded-md p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">{msg.text}</p>}
      {note && <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900">{note}</p>}
      {busy && <p className="text-sm text-zinc-600" aria-live="polite">{busy}</p>}

      {/* 1. Mode ------------------------------------------------------------ */}
      <section className={card} aria-labelledby="mode-h">
        <h2 id="mode-h" className="font-semibold">1. How should pins be sorted into boards?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Board mode">
          {BOARD_MODES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={settings.mode === m}
              onClick={() => setSettings({ ...settings, mode: m })}
              className={`rounded-lg border p-3 text-left ${settings.mode === m ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"}`}
            >
              <span className="block text-sm font-semibold">{BOARD_MODE_LABELS[m].title}{m === "auto" ? " (default)" : ""}</span>
              <span className={`mt-1 block text-xs ${settings.mode === m ? "text-zinc-200" : "text-zinc-600"}`}>{BOARD_MODE_LABELS[m].detail}</span>
            </button>
          ))}
        </div>

        {settings.mode === "manual" && (
          <div className="mt-3 flex flex-col gap-1 text-sm">
            <label htmlFor="manual-board" className="text-xs font-medium">Board for every pin</label>
            <BoardSelect id="manual-board" boards={boards} value={settings.manual_board_id} onChange={(b) => setSettings({ ...settings, manual_board_id: b?.board_id ?? null, manual_board_name: b?.name ?? null })} />
          </div>
        )}

        {settings.mode === "rules" && <RulesEditor settings={settings} boards={boards} onChange={setSettings} />}

        <div className="mt-3 flex items-center gap-3">
          <button disabled={!settingsDirty || (settings.mode === "manual" && !settings.manual_board_id)} onClick={() => saveSettings()} className={`${btn} bg-zinc-900 text-white`}>
            Save mode
          </button>
          {settingsDirty && <span className="text-xs text-zinc-500">Unsaved changes</span>}
        </div>
      </section>

      {/* 2. Pins ------------------------------------------------------------- */}
      <section className={card} aria-labelledby="pins-h">
        <h2 id="pins-h" className="font-semibold">2. Boards for your pins</h2>
        <p className="mt-1 text-xs text-zinc-600">Pins that aren&apos;t scheduled or published yet. New pins from the Studio get a board automatically (except in Custom mode).</p>
        {pinRows.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">No pins yet. <Link href={`/w/${kind}`} className="underline">Make some in the Studio.</Link></p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={Boolean(busy)} onClick={() => assignPins(true)} className={`${btn} bg-red-700 text-white`}>
                Pick boards for pins without one ({pinRows.filter((r) => !r.saved).length})
              </button>
              <button disabled={Boolean(busy)} onClick={() => assignPins(false)} className={`${btn} border border-zinc-300`}>Re-check all pins</button>
              {unsavedPins > 0 && <button onClick={savePinRows} className={`${btn} bg-zinc-900 text-white`}>Save {unsavedPins} board choice{unsavedPins === 1 ? "" : "s"}</button>}
            </div>
            <Grouped
              rows={pinRows}
              boards={boards}
              onChange={(key, b) => setPinRows((rows) => rows.map((r) => (r.key === key ? { ...r, board_id: b?.board_id ?? null, board_name: b?.name ?? null, method: "custom", saved: false, reason: b ? "You chose this board." : "" } : r)))}
              checksFor={(r) => boardChecks(r.board_id, boards, { connectedUsername: src.username, demo: src.sample, facts: facts.get(r.key)!, plan: r.board_id ? { board_id: r.board_id, method: r.method, confidence: r.confidence } : null }).filter((c) => !(src.sample && c.id === "owned"))}
            />
          </>
        )}
      </section>

      {/* 3. New boards ----------------------------------------------------- */}
      {suggestions.length > 0 && (
        <section className={card} aria-labelledby="new-h">
          <h2 id="new-h" className="font-semibold">3. Suggested new boards</h2>
          <p className="mt-1 text-xs text-zinc-600">
            Some pins don&apos;t fit any board you have. A board is only created when you click “Create” and confirm, and never if one with the same name already exists.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {suggestions.map(({ s, count }) => (
              <NewBoardCard key={boardNameKey(s.name)} kind={kind} suggestion={s} count={count} src={src} onCreated={onBoardCreated} />
            ))}
          </div>
        </section>
      )}

      {/* 4. Bulk ------------------------------------------------------------- */}
      <section className={card} aria-labelledby="bulk-h">
        <h2 id="bulk-h" className="font-semibold">{suggestions.length > 0 ? "4" : "3"}. Bulk keywords (up to {MAX_BULK_KEYWORDS})</h2>
        <p className="mt-1 text-xs text-zinc-600">
          Paste keywords, one per line. Each one gets its own category and board. Save the plan, and pins you later make from these keywords go to the planned board.
        </p>
        <label htmlFor="bulk-kw" className="sr-only">Keywords</label>
        <textarea id="bulk-kw" rows={5} className="mt-3 w-full rounded-md border border-zinc-300 p-2 text-sm" placeholder={"bridal mehndi outfits\nsmall living room decor\nfree budget planner printable"} value={kwText} onChange={(e) => setKwText(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button disabled={Boolean(busy) || !kwText.trim()} onClick={runBulk} className={`${btn} bg-red-700 text-white`}>Categorise & pick boards</button>
          <span className="text-xs text-zinc-500">{parseKeywords(kwText).keywords.length} / {MAX_BULK_KEYWORDS}</span>
          {kwRows.length > 0 && (
            <>
              <button onClick={saveBulkPlan} className={`${btn} bg-zinc-900 text-white`} disabled={kwRows.every((r) => r.saved)}>Save plan</button>
              <button
                className={`${btn} border border-zinc-300`}
                onClick={() => downloadFile(`board-plan-${kind}.csv`, toCsv(["keyword", "category", "board", "reason"], kwRows.map((r) => [r.keyword, r.category, r.board_name ?? "", r.reason])), "text/csv")}
              >
                Download CSV
              </button>
            </>
          )}
        </div>
        {kwRows.length > 0 && (
          <Grouped
            rows={kwRows}
            boards={boards}
            studioLink={(r) => `/w/${kind}?idea=${encodeURIComponent(r.keyword)}`}
            onChange={(key, b) => setKwRows((rows) => rows.map((r) => (r.key === key ? { ...r, board_id: b?.board_id ?? null, board_name: b?.name ?? null, method: "custom", saved: false, reason: b ? "You chose this board." : "" } : r)))}
          />
        )}
      </section>
    </div>
  );
}

/** Pins that can still get a board (not archived, scheduled or published). */
function eligible(ds: PinDraft[]) {
  return ds.filter((d) => !d.archived_at && d.status !== "scheduled" && d.status !== "published");
}

function uniqueSuggestions(rows: Row[], boards: Board[]) {
  const map = new Map<string, { s: NewBoardSuggestion; count: number }>();
  for (const r of rows) {
    if (r.board_id || !r.new_board || findBoardByName(boards, r.new_board.name)) continue;
    const k = boardNameKey(r.new_board.name);
    const cur = map.get(k);
    if (cur) cur.count++;
    else map.set(k, { s: r.new_board, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 8);
}

function BoardSelect({ id, boards, value, onChange }: { id: string; boards: Board[]; value: string | null; onChange: (b: Board | null) => void }) {
  return (
    <select id={id} className="min-w-0 rounded-md border border-zinc-300 px-2 py-1 text-sm" value={value ?? ""} onChange={(e) => onChange(boards.find((b) => b.board_id === e.target.value) ?? null)}>
      <option value="">No board</option>
      {boards.map((b) => (
        <option key={b.board_id} value={b.board_id}>{b.name}</option>
      ))}
    </select>
  );
}

function RulesEditor({ settings, boards, onChange }: { settings: BoardSettings; boards: Board[]; onChange: (s: BoardSettings) => void }) {
  const [kw, setKw] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const rules = settings.rules;
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <p className="text-xs text-zinc-600">If a pin mentions the keyword, it goes to that board. Pins with no matching rule are picked by AI.</p>
      {rules.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rules.map((r, i) => (
            <li key={`${r.keyword}-${i}`} className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 px-2 py-1">
              <span>“{r.keyword}”</span>
              <span aria-hidden>→</span>
              <span className="font-medium">{r.board_name}</span>
              {!boards.some((b) => b.board_id === r.board_id) && <span className="text-xs text-amber-700">(board not on this account)</span>}
              <button className="ml-auto text-xs text-zinc-600 underline" onClick={() => onChange({ ...settings, rules: rules.filter((_, j) => j !== i) })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="rule-kw" className="text-xs font-medium">Keyword</label>
          <input id="rule-kw" className="rounded-md border border-zinc-300 px-2 py-1" placeholder="wedding" value={kw} maxLength={100} onChange={(e) => setKw(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rule-board" className="text-xs font-medium">Board</label>
          <BoardSelect id="rule-board" boards={boards} value={board?.board_id ?? null} onChange={setBoard} />
        </div>
        <button
          disabled={!kw.trim() || !board}
          className={`${btn} border border-zinc-300`}
          onClick={() => {
            onChange({ ...settings, rules: [...rules, { keyword: kw.trim(), board_id: board!.board_id, board_name: board!.name }] });
            setKw("");
          }}
        >
          Add rule
        </button>
      </div>
    </div>
  );
}

function Grouped({
  rows,
  boards,
  onChange,
  checksFor,
  studioLink,
}: {
  rows: Row[];
  boards: Board[];
  onChange: (key: string, b: Board | null) => void;
  checksFor?: (r: Row) => ReturnType<typeof boardChecks>;
  studioLink?: (r: Row) => string;
}) {
  const groups = useMemo(() => groupByBoard(rows), [rows]);
  return (
    <div className="mt-4 flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.board_id ?? "none"}>
          <h3 className="mb-1 text-sm font-semibold">
            {g.board_id ? g.board_name : "No board yet"} <span className="font-normal text-zinc-500">· {g.rows.length}</span>
          </h3>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {g.rows.map((r) => {
              const checks = checksFor?.(r) ?? [];
              const failing = checks.filter((c) => !c.ok);
              return (
                <li key={r.key} className="flex flex-col gap-2 p-2 text-sm sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={r.label}>{r.label}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-zinc-600">
                      {r.category && <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.category}</span>}
                      {r.reason && <span className="rounded bg-zinc-100 px-1.5 py-0.5">{METHOD_LABELS[r.method]}{r.confidence != null && r.method === "ai" ? ` · ${r.confidence}%` : ""}</span>}
                      {!r.saved && r.board_id && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">Not saved</span>}
                      <span className="min-w-0">{r.reason}</span>
                    </p>
                    {r.board_id && failing.length > 0 && <p className="mt-1 text-xs text-amber-800">⚠ {failing.map((c) => c.label).join(" · ")}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`b-${r.key}`}>Board for {r.label}</label>
                    <BoardSelect id={`b-${r.key}`} boards={boards} value={r.board_id} onChange={(b) => onChange(r.key, b)} />
                    {studioLink && <Link href={studioLink(r)} className="whitespace-nowrap text-xs underline">Make pins</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NewBoardCard({ kind, suggestion, count, src, onCreated }: { kind: WorkspaceKind; suggestion: NewBoardSuggestion; count: number; src: BoardSource; onCreated: (b: Board, key: string) => void }) {
  const [name, setName] = useState(suggestion.name);
  const [description, setDescription] = useState(suggestion.description);
  const [secret, setSecret] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dup = findBoardByName(src.boards, name);
  const canCreate = !src.sample && src.active && src.scopes.includes("boards:write");
  const why = src.sample
    ? "Demo: connect Pinterest to create real boards."
    : !src.active
      ? "Reconnect Pinterest first."
      : !src.scopes.includes("boards:write")
        ? "Pinterest hasn't granted board permission (boards:write). Turn on publishing and reconnect."
        : null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pinterest/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, name: name.trim(), description: description.trim(), privacy: secret ? "SECRET" : "PUBLIC", confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not create the board (${res.status})`);
      onCreated(body.board, boardNameKey(suggestion.name));
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
      <p className="text-xs text-zinc-500">For {count} pin{count === 1 ? "" : "s"}</p>
      <label className="text-xs font-medium" htmlFor={`nb-${suggestion.name}`}>Board name</label>
      <input id={`nb-${suggestion.name}`} className="rounded-md border border-zinc-300 px-2 py-1" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="text-xs font-medium" htmlFor={`nd-${suggestion.name}`}>SEO description</label>
      <textarea id={`nd-${suggestion.name}`} rows={2} maxLength={500} className="rounded-md border border-zinc-300 p-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {suggestion.keywords.map((k) => (
          <span key={k} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{k}</span>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Secret board (only you can see it)
      </label>
      {dup && <p className="text-xs text-amber-800">A board named “{dup.name}” already exists. Pick it for these pins instead of making a duplicate.</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2">
          <span className="text-xs text-red-900">Create “{name.trim()}” on {src.username ? `@${src.username}` : "your account"} ({src.env === "sandbox" ? "Sandbox" : "live"})?</span>
          <button disabled={busy} onClick={create} className={`${btn} bg-red-700 text-white`}>{busy ? "Creating…" : "Yes, create board"}</button>
          <button onClick={() => setConfirming(false)} className="text-xs underline">Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={!canCreate || Boolean(dup) || !name.trim()} onClick={() => setConfirming(true)} className={`${btn} border border-zinc-300`}>Create board…</button>
          {why && <span className="text-xs text-zinc-500">{why}</span>}
        </div>
      )}
    </article>
  );
}
