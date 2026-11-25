"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandSettings, Category, DraftContent, DraftStatus, DraftVersion, PinDraft, WorkspaceKind } from "@/lib/types";
import { STATUS_LABELS, WORKSPACE_LABELS } from "@/lib/types";
import { EMPTY_FILTER, filterDrafts, libraryDuplicates, type LibraryFilter } from "@/lib/library/filter";
import { draftsToCsv } from "@/lib/tools/csv";
import { DraftEditor, draftErrors } from "./DraftEditor";
import { DraftImage } from "./DraftImage";
import { useWorkspace } from "./useWorkspace";
import { useTrendKeywords } from "@/lib/client/useTrendKeywords";
import { downloadFile, downloadImage as saveImage } from "@/lib/client/download";

const pick = (d: PinDraft): DraftContent => ({
  angle: d.angle, concept: d.concept, title: d.title, description: d.description, tags: d.tags, alt_text: d.alt_text, image_prompt: d.image_prompt,
});

const PAGE = 24;

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

  if (wsError) return <p className="text-red-700">Could not load workspace: {wsError}</p>;
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
        body: JSON.stringify({ workspace: kind, idea: d.idea, category: catName(d.category_id) || undefined, brand }),
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
  const ctl = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  const btn = "text-sm text-zinc-700 hover:underline disabled:opacity-40";
  const archivedCount = drafts.filter((d) => d.archived_at).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">{workspace.name || WORKSPACE_LABELS[kind]} · pin library ({drafts.length - archivedCount}{archivedCount ? ` + ${archivedCount} archived` : ""})</h1>
        <div className="flex gap-3 text-sm">
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

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3" role="search">
        <input aria-label="Search pins" className={`${ctl} min-w-48 flex-1`} placeholder="Search titles, descriptions, tags…" value={filter.q} onChange={(e) => set("q", e.target.value)} />
        <select aria-label="Status" className={ctl} value={filter.status} onChange={(e) => set("status", e.target.value as LibraryFilter["status"])}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABELS) as DraftStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          <option value="archived">Archived</option>
        </select>
        <select aria-label="Category" className={`${ctl} max-w-56`} value={filter.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
          <option value="">All categories</option>
          {categories
            .filter((c) => !c.parent_id)
            .flatMap((c) => [c, ...categories.filter((s) => s.parent_id === c.id)])
            .map((c) => <option key={c.id} value={c.id}>{c.parent_id ? `   ${catName(c.id)}` : c.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-zinc-600">From <input type="date" className={ctl} value={filter.from} onChange={(e) => set("from", e.target.value)} /></label>
        <label className="flex items-center gap-1 text-xs text-zinc-600">To <input type="date" className={ctl} value={filter.to} onChange={(e) => set("to", e.target.value)} /></label>
        <label className="flex items-center gap-1 text-xs text-zinc-600">
          <input type="checkbox" checked={filter.showArchived} onChange={(e) => set("showArchived", e.target.checked)} /> Include archived
        </label>
        {JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER) && (
          <button className="text-xs underline" onClick={() => setFilter(EMPTY_FILTER)}>Clear</button>
        )}
        <span className="ml-auto text-xs text-zinc-500">{visible.length} shown</span>
      </div>

      {msg?.id === "" && <p className="text-sm text-red-700">{msg.text}</p>}
      {drafts.length === 0 && <p className="text-zinc-600">No saved pins yet. Make some in the Studio.</p>}
      {drafts.length > 0 && visible.length === 0 && <p className="text-zinc-600">No pins match these filters.</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.slice(0, shown).map((d, i) => {
          const current = edits[d.id] ?? pick(d);
          const similar = dupes.get(d.id) ?? [];
          const locked = d.status === "scheduled" || d.status === "published";
          return (
            <div key={d.id} className={`flex flex-col gap-1 ${d.archived_at ? "opacity-70" : ""}`}>
              <p className="text-xs text-zinc-500">
                Idea: “{d.idea}”{catName(d.category_id) ? ` · ${catName(d.category_id)}` : ""} · {STATUS_LABELS[d.status]}
                {d.archived_at ? " · Archived" : ""} · {new Date(d.created_at).toLocaleString()} · Job {d.batch_id.slice(0, 8)}
              </p>
              {d.duplicate_of && <p className="text-xs text-sky-700">Intentional copy of “{drafts.find((x) => x.id === d.duplicate_of)?.title ?? "a deleted pin"}”</p>}
              {similar.length > 0 && (
                <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  Looks very similar to “{drafts.find((x) => x.id === similar[0])?.title}”{similar.length > 1 ? ` and ${similar.length - 1} more` : ""}. Change the angle or archive one.
                </p>
              )}
              <DraftEditor
                key={d.updated_at}
                index={i}
                draft={current}
                source={d.source}
                imageStatus={d.image_status}
                quality={{ bannedWords: brand?.banned_words, focusKeywords: brand?.focus_keywords, trendKeywords, today: new Date(), link: d.link }}
                onChange={(nd) => setEdits((all) => ({ ...all, [d.id]: nd }))}
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button onClick={() => saveEdit(d)} disabled={!edits[d.id]} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                        Save changes
                      </button>
                      <button onClick={() => regenerate(d)} disabled={locked || busyId === d.id} className={btn}>{busyId === d.id ? "Rewriting…" : "Rewrite this pin"}</button>
                      <button onClick={() => duplicate(d)} className={btn}>Duplicate</button>
                      <button onClick={() => showHistory(d)} className={btn}>{history?.id === d.id ? "Hide history" : "History"}</button>
                      {d.image_status === "ready" && <button onClick={() => downloadImage(d)} className={btn}>Download image</button>}
                      <button onClick={() => archive(d, !d.archived_at)} disabled={d.status === "scheduled"} className={btn}>{d.archived_at ? "Unarchive" : "Archive"}</button>
                      <button onClick={() => remove(d)} className="text-sm text-red-700 hover:underline">Delete</button>
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

