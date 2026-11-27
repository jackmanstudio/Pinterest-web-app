"use client";
import { PageTitle } from "./PageTitle";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandSettings, Category, DraftContent, DraftStatus, DraftVersion, PinDraft, WorkspaceKind } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";
import { EMPTY_FILTER, filterDrafts, libraryDuplicates, type LibraryFilter } from "@/lib/library/filter";
import { draftsToCsv } from "@/lib/tools/csv";
import { DraftEditor, draftErrors } from "./DraftEditor";
import { DraftImage } from "./DraftImage";
import { useWorkspace } from "./useWorkspace";
import { useTrendKeywords } from "@/lib/client/useTrendKeywords";
import { downloadFile, downloadImage as saveImage } from "@/lib/client/download";
import { autoFixDraft, type FixContext, type FixResult } from "@/lib/drafts/autofix";
import { reviewDraft } from "@/lib/drafts/quality";
import { WorkspaceError } from "./WorkspaceError";

const pick = (d: PinDraft): DraftContent => ({
  angle: d.angle, concept: d.concept, title: d.title, description: d.description, tags: d.tags, alt_text: d.alt_text, image_prompt: d.image_prompt,
});

const PAGE = 24;

const STATUS_PILL: Record<DraftStatus, string> = {
  draft: "bg-white/10 text-white/80",
  in_review: "bg-amber-400/15 text-amber-200",
  approved: "bg-sky-400/15 text-sky-200",
  scheduled: "bg-violet-400/15 text-violet-200",
  published: "bg-emerald-400/15 text-emerald-200",
};

/** Glass select with its own chevron, so every filter looks the same in every browser. */
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="relative flex min-w-0 items-center">
      <span className="sr-only">{label}</span>
      <select aria-label={label} className="au-field h-11 w-full min-w-0 appearance-none truncate pl-4 pr-10 text-sm font-medium" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-3.5 h-4 w-4 text-white/55" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </label>
  );
}

export function SavedDrafts({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const trendKeywords = useTrendKeywords(kind);
  const [drafts, setDrafts] = useState<PinDraft[] | null>(null);
  const [edits, setEdits] = useState<Record<string, DraftContent>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);
  const [shown, setShown] = useState(PAGE);
  const [history, setHistory] = useState<{ id: string; versions: DraftVersion[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Last automatic fix per pin, with the text it replaced (for Undo). */
  const [fixes, setFixes] = useState<Record<string, { result: FixResult; prev: DraftContent & { link: string | null } }>>({});
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number; fixed: number; before: number; after: number } | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    Promise.all([store.listDrafts(workspace.id), store.listCategories(workspace.id), store.getBrand(workspace.id)])
      .then(([d, c, b]) => {
        setDrafts(d);
        setCategories(c);
        setBrand(b);
      })
      .catch((e: Error) => setMsg({ id: "", text: e.message, ok: false }));
  }, [store, workspace]);

  const childIds = (id: string) => categories.filter((c) => c.parent_id === id).map((c) => c.id);
  const visible = useMemo(() => (drafts ? filterDrafts(drafts, filter, childIds) : []), [drafts, filter, categories]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupes = useMemo(() => libraryDuplicates(drafts ?? []), [drafts]);

  if (wsError) return <WorkspaceError error={wsError} />;
  if (!store || !workspace || !drafts) return <p className="text-zinc-500">Loading pin library…</p>;

  const replace = (u: PinDraft) => setDrafts((all) => all!.map((x) => (x.id === u.id ? u : x)));
  const fail = (id: string, err: unknown) => setMsg({ id, text: (err as Error).message, ok: false });
  const catName = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return "";
    const p = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
    return p ? `${p.name} › ${c.name}` : c.name;
  };

  async function saveEdit(d: PinDraft) {
    const e = edits[d.id];
    if (!e || !store || !workspace) return;
    if (draftErrors(e).length) return setMsg({ id: d.id, text: "Fix the highlighted fields first.", ok: false });
    try {
      replace(await store.updateDraft(workspace.id, d.id, e));
      setEdits((all) => {
        const rest = { ...all };
        delete rest[d.id];
        return rest;
      });
      setMsg({ id: d.id, text: "Saved. The previous text is kept in History.", ok: true });
      // Refresh an open History panel so the version just kept shows up.
      if (history?.id === d.id) setHistory({ id: d.id, versions: await store.listVersions(workspace.id, d.id) });
    } catch (err) {
      fail(d.id, err);
    }
  }

  async function remove(d: PinDraft) {
    if (!store || !workspace) return;
    if (!window.confirm(`Delete “${d.title}” permanently? Archive keeps it instead.`)) return;
    try {
      await store.deleteDraft(workspace.id, d.id);
      setDrafts((all) => all!.filter((x) => x.id !== d.id));
    } catch (err) {
      fail(d.id, err);
    }
  }

  async function duplicate(d: PinDraft) {
    try {
      const copy = await store!.duplicateDraft(workspace!.id, d.id);
      setDrafts((all) => [copy, ...all!]);
      setMsg({ id: copy.id, text: "Copy created. Generate a new image for it so the pins don't look the same.", ok: true });
    } catch (err) {
      fail(d.id, err);
    }
  }

  async function archive(d: PinDraft, on: boolean) {
    try {
      replace(await store!.updateDraft(workspace!.id, d.id, { archived_at: on ? new Date().toISOString() : null }));
    } catch (err) {
      fail(d.id, err);
    }
  }

  async function showHistory(d: PinDraft) {
    if (history?.id === d.id) return setHistory(null);
    try {
      setHistory({ id: d.id, versions: await store!.listVersions(workspace!.id, d.id) });
    } catch (err) {
      fail(d.id, err);
    }
  }

  async function restore(d: PinDraft, v: DraftVersion) {
    try {
      const u = await store!.updateDraft(workspace!.id, d.id, {
        title: v.title, description: v.description, tags: v.tags, alt_text: v.alt_text, concept: v.concept, image_prompt: v.image_prompt, link: v.link,
      });
      replace(u);
      setEdits((all) => {
        const rest = { ...all };
        delete rest[d.id];
        return rest;
      });
      setHistory({ id: d.id, versions: await store!.listVersions(workspace!.id, d.id) });
      setMsg({ id: d.id, text: "Restored. The text you replaced is now in History too.", ok: true });
    } catch (err) {
      fail(d.id, err);
    }
  }

  /** Rewrites this one pin's text with the AI, keeping the other pins of its batch untouched. */
  async function regenerate(d: PinDraft) {
    setBusyId(d.id);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, idea: d.idea, category: catName(d.category_id) || undefined, brand, trend_keywords: trendKeywords.length ? trendKeywords : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not regenerate");
      const fresh: DraftContent[] = body.drafts;
      const next = fresh.find((x) => x.angle === d.angle) ?? fresh[0];
      replace(await store!.updateDraft(workspace!.id, d.id, { ...next }));
      setMsg({ id: d.id, text: `New text written${body.source === "demo" ? " (demo template)" : ""}. Old text is in History. Make a new image if the prompt changed.`, ok: true });
    } catch (err) {
      fail(d.id, err);
    } finally {
      setBusyId(null);
    }
  }

  const qualityCtx = (d: PinDraft): FixContext => ({
    bannedWords: brand?.banned_words, focusKeywords: brand?.focus_keywords, trendKeywords, today: new Date(), idea: d.idea, link: d.link, website: brand?.website_url,
  });
  const isLocked = (d: PinDraft) => d.status === "scheduled" || d.status === "published";

  /** Applies the safe automatic fixes to one pin and saves it (the old text goes to History). */
  async function applyFix(d: PinDraft): Promise<FixResult | null> {
    const content = edits[d.id] ?? pick(d);
    const r = autoFixDraft(content, d.link, qualityCtx(d));
    if (!r.changes.length) return null;
    const u = await store!.updateDraft(workspace!.id, d.id, { ...r.content, link: r.link });
    replace(u);
    setEdits((all) => {
      const rest = { ...all };
      delete rest[d.id];
      return rest;
    });
    setFixes((all) => ({ ...all, [d.id]: { result: r, prev: { ...pick(d), link: d.link } } }));
    return r;
  }

  async function fixOne(d: PinDraft) {
    setBusyId(d.id);
    try {
      if (!(await applyFix(d))) setMsg({ id: d.id, text: "Nothing to fix automatically. The notes left need your own edit.", ok: true });
    } catch (err) {
      fail(d.id, err);
    } finally {
      setBusyId(null);
    }
  }

  async function undoFix(d: PinDraft) {
    const f = fixes[d.id];
    if (!f) return;
    try {
      replace(await store!.updateDraft(workspace!.id, d.id, f.prev));
      setFixes((all) => {
        const rest = { ...all };
        delete rest[d.id];
        return rest;
      });
      setMsg({ id: d.id, text: "Undone. The pin has its earlier text again.", ok: true });
    } catch (err) {
      fail(d.id, err);
    }
  }

  /** Runs the automatic fix on every pin that is not scheduled, published or archived. */
  async function fixAll() {
    const targets = drafts!.filter((d) => !d.archived_at && !isLocked(d));
    const scoreOf = (d: PinDraft) => reviewDraft(edits[d.id] ?? pick(d), qualityCtx(d)).score;
    const avg = (n: number[]) => (n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : 0);
    const before = targets.map(scoreOf);
    const after = [...before];
    setBulk({ running: true, done: 0, total: targets.length, fixed: 0, before: avg(before), after: avg(before) });
    let fixed = 0;
    for (const [i, d] of targets.entries()) {
      try {
        const r = await applyFix(d);
        if (r) {
          fixed++;
          after[i] = r.after;
        }
      } catch (err) {
        fail(d.id, err);
      }
      setBulk({ running: true, done: i + 1, total: targets.length, fixed, before: avg(before), after: avg(after) });
    }
    setBulk({ running: false, done: targets.length, total: targets.length, fixed, before: avg(before), after: avg(after) });
  }

  async function downloadImage(d: PinDraft) {
    try {
      const url = await store!.imageUrl(d);
      if (!url) throw new Error("No image yet");
      await saveImage(url, d.title);
    } catch (err) {
      fail(d.id, err);
    }
  }

  const set = <K extends keyof LibraryFilter>(k: K, v: LibraryFilter[K]) => {
    setFilter({ ...filter, [k]: v });
    setShown(PAGE);
  };
  const ctl = "au-field h-11 px-4 text-sm font-medium";
  const menu = "rounded-lg px-3 py-2 text-left text-[13px] font-medium text-white/85 hover:bg-white/[0.08] disabled:opacity-40";
  const btn = "rounded-lg bg-white/[0.06] px-2.5 py-1 text-[13px] font-medium text-white/80 ring-1 ring-white/10 hover:bg-white/[0.12] hover:text-white disabled:opacity-40";
  const archivedCount = drafts.filter((d) => d.archived_at).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          kind={kind}
          title="Pin"
          accent="library"
          chips={<span className="au-glass rounded-full px-3 py-1 font-medium text-white/75">{drafts.length - archivedCount} pins{archivedCount ? ` · ${archivedCount} archived` : ""}</span>}
          sub="Every pin you made in this workspace. Search, filter, edit and export."
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            onClick={fixAll}
            disabled={bulk?.running || !drafts.some((d) => !d.archived_at && !isLocked(d))}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-3.5 py-1.5 font-bold text-white shadow-[0_8px_20px_-10px_rgba(255,90,60,0.9)] hover:brightness-110 disabled:opacity-45"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5L9 20H4v-5z" /><path d="m13 6 5 5" /></svg>
            {bulk?.running ? `Fixing ${bulk.done}/${bulk.total}…` : "Fix all pins"}
          </button>
          <button onClick={() => downloadFile(`${kind}-pins.csv`, draftsToCsv(visible, catName))} disabled={!visible.length} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 disabled:opacity-40">
            Export {visible.length} to CSV
          </button>
          <Link href={`/w/${kind}/tools#import`} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50">Import CSV</Link>
        </div>
      </div>
      {store.mode === "demo" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Demo storage: these drafts live only in this browser and are not synced anywhere.
        </p>
      )}

      <div className="au-glass flex flex-col gap-4 rounded-2xl px-4 py-4 sm:px-6 sm:py-5" role="search">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_11rem_15rem]">
          <label className="group relative flex min-w-0 items-center">
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-4 h-4 w-4 text-white/45 transition-colors group-focus-within:text-[#ff8a6a]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span className="sr-only">Search pins</span>
            <input className={`${ctl} w-full !pl-11`} placeholder="Search titles, descriptions, tags…" value={filter.q} onChange={(e) => set("q", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3 lg:contents">
            <Select label="Status" value={filter.status} onChange={(v) => set("status", v as LibraryFilter["status"])}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABELS) as DraftStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              <option value="archived">Archived</option>
            </Select>
            <Select label="Category" value={filter.categoryId} onChange={(v) => set("categoryId", v)}>
              <option value="">All categories</option>
              {categories
                .filter((c) => !c.parent_id)
                .flatMap((c) => [c, ...categories.filter((s) => s.parent_id === c.id)])
                .map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `   ${catName(c.id)}` : c.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex h-11 w-full min-w-0 items-center gap-1.5 rounded-[0.875rem] border border-white/12 bg-white/[0.05] pl-3.5 pr-1.5 transition-colors hover:border-white/25 sm:w-auto sm:gap-2">
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white/45" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
            <span className="hidden text-[13px] font-medium text-white/55 sm:inline">Date</span>
            <input type="date" aria-label="From date" className={`au-date min-w-0 flex-1 sm:flex-none ${filter.from ? "" : "!text-white/50"}`} value={filter.from} onChange={(e) => set("from", e.target.value)} />
            <span aria-hidden className="text-white/35">–</span>
            <input type="date" aria-label="To date" className={`au-date min-w-0 flex-1 sm:flex-none ${filter.to ? "" : "!text-white/50"}`} value={filter.to} onChange={(e) => set("to", e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2 sm:contents">
          <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-[0.875rem] px-3 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white">
            <input type="checkbox" className="h-4 w-4" checked={filter.showArchived} onChange={(e) => set("showArchived", e.target.checked)} /> Include archived
          </label>
          <div className="flex items-center gap-2 sm:ml-auto">
            {JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER) && (
              <button className="h-9 rounded-lg px-3 text-[13px] font-semibold text-[#ff8a6a] hover:bg-white/[0.06]" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>
            )}
            <span className="rounded-full bg-white/[0.07] px-3 py-1 text-xs font-semibold text-white/70 ring-1 ring-white/10">{visible.length} shown</span>
          </div>
          </div>
        </div>
      </div>

      {bulk && (
        <div className="au-glass flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm" role="status">
          {bulk.running ? (
            <span className="text-white/80">Optimising pins… {bulk.done} of {bulk.total} checked</span>
          ) : (
            <span className="text-white/85">
              <span className="font-bold text-emerald-300">{bulk.fixed} {bulk.fixed === 1 ? "pin" : "pins"} optimised</span>
              {bulk.total - bulk.fixed > 0 && <>, {bulk.total - bulk.fixed} had nothing to fix</>}
              {" "}· average score {bulk.before} → <span className="font-bold text-white">{bulk.after}</span>. Scheduled, published and archived pins were left as they are. Open Details on a pin to see what changed.
            </span>
          )}
          {!bulk.running && <button onClick={() => setBulk(null)} className="ml-auto rounded-md px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/[0.08] hover:text-white">Dismiss</button>}
        </div>
      )}
      {msg?.id === "" && <p className="text-sm text-red-700">{msg.text}</p>}
      {drafts.length === 0 && <p className="text-zinc-600">No saved pins yet. Make some in the Studio.</p>}
      {drafts.length > 0 && visible.length === 0 && <p className="text-zinc-600">No pins match these filters.</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.slice(0, shown).map((d, i) => {
          const current = edits[d.id] ?? pick(d);
          const similar = dupes.get(d.id) ?? [];
          const locked = d.status === "scheduled" || d.status === "published";
          return (
            <div key={d.id} className={d.archived_at ? "opacity-70" : ""}>
              <DraftEditor
                key={d.updated_at}
                index={i}
                draft={current}
                source={d.source}
                imageStatus={d.image_status}
                quality={qualityCtx(d)}
                fix={{
                  onFix: () => fixOne(d),
                  busy: busyId === d.id || Boolean(bulk?.running),
                  available: !locked && autoFixDraft(current, d.link, qualityCtx(d)).changes.length > 0,
                  result: fixes[d.id]?.result,
                  onUndo: () => undoFix(d),
                }}
                onChange={(nd) => setEdits((all) => ({ ...all, [d.id]: nd }))}
                layout="card"
                owner={{ name: brand?.brand_name || workspace.name || "Your account", board: catName(d.category_id) || null }}
                meta={
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                      <span className={`rounded-full px-2 py-0.5 ${STATUS_PILL[d.status]}`}>{STATUS_LABELS[d.status]}</span>
                      {d.archived_at && <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/70">Archived</span>}
                      <span className="ml-auto font-medium text-white/45">{new Date(d.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="truncate text-xs text-white/50" title={`Idea: ${d.idea} · Job ${d.batch_id.slice(0, 8)}`}>Idea: “{d.idea}”</p>
                    {d.duplicate_of && <p className="text-xs text-sky-700">Intentional copy of “{drafts.find((x) => x.id === d.duplicate_of)?.title ?? "a deleted pin"}”</p>}
                    {similar.length > 0 && (
                      <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        Looks very similar to “{drafts.find((x) => x.id === similar[0])?.title}”{similar.length > 1 ? ` and ${similar.length - 1} more` : ""}. Change the angle or archive one.
                      </p>
                    )}
                  </div>
                }
                media={
                  <DraftImage
                    kind={kind}
                    store={store}
                    draft={d}
                    promptDirty={Boolean(edits[d.id] && edits[d.id].image_prompt !== d.image_prompt)}
                    onUpdated={replace}
                  />
                }
                footer={
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {edits[d.id] && (
                        <button onClick={() => saveEdit(d)} className="rounded-lg bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-3.5 py-1.5 text-[13px] font-bold text-white shadow-[0_8px_20px_-10px_rgba(255,90,60,0.9)] hover:brightness-110">
                          Save changes
                        </button>
                      )}
                      <button onClick={() => regenerate(d)} disabled={locked || busyId === d.id} className={btn}>{busyId === d.id ? "Rewriting…" : "Rewrite"}</button>
                      {d.image_status === "ready" && <button onClick={() => downloadImage(d)} className={btn}>Download</button>}
                      <details className="relative ml-auto">
                        <summary className={`${btn} cursor-pointer list-none`} aria-label="More actions">More ▾</summary>
                        <div className="absolute bottom-full right-0 z-20 mb-2 flex w-44 flex-col rounded-xl border border-white/10 bg-[#1a1426] p-1.5 shadow-2xl">
                          <button onClick={() => duplicate(d)} className={menu}>Duplicate</button>
                          <button onClick={() => showHistory(d)} className={menu}>{history?.id === d.id ? "Hide history" : "History"}</button>
                          <button onClick={() => archive(d, !d.archived_at)} disabled={d.status === "scheduled"} className={menu}>{d.archived_at ? "Unarchive" : "Archive"}</button>
                          <button onClick={() => remove(d)} className={`${menu} !text-[#ff6b80] hover:!bg-red-500/10`}>Delete</button>
                        </div>
                      </details>
                    </div>
                    {msg?.id === d.id && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
                    {history?.id === d.id && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs">
                        <p className="mb-1 font-medium">Earlier versions (last 30 kept)</p>
                        {history.versions.length === 0 && <p className="text-zinc-500">No earlier versions yet. Every save keeps the previous text here.</p>}
                        <ul className="flex flex-col gap-2">
                          {history.versions.map((v) => (
                            <li key={v.id} className="flex items-start justify-between gap-2 border-t border-zinc-200 pt-1 first:border-0">
                              <span>
                                <span className="text-zinc-500">{new Date(v.created_at).toLocaleString()} · by {v.changed_by}</span>
                                <br />
                                <span className="font-medium">{v.title}</span>
                                <br />
                                <span className="text-zinc-600">{v.description.slice(0, 120)}{v.description.length > 120 ? "…" : ""}</span>
                              </span>
                              <button onClick={() => restore(d, v)} disabled={locked} className="shrink-0 underline disabled:opacity-40">Restore</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                }
              />
            </div>
          );
        })}
      </div>
      {visible.length > shown && (
        <button onClick={() => setShown(shown + PAGE)} className="self-center rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
          Show more ({visible.length - shown} left)
        </button>
      )}
    </div>
  );
}

