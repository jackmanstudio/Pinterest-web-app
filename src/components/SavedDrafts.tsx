"use client";
import { useEffect, useState } from "react";
import type { Category, DraftContent, PinDraft, WorkspaceKind } from "@/lib/types";
import { WORKSPACE_LABELS } from "@/lib/types";
import { DraftEditor, draftErrors } from "./DraftEditor";
import { DraftImage } from "./DraftImage";
import { useWorkspace } from "./useWorkspace";

const pick = (d: PinDraft): DraftContent => ({
  angle: d.angle, concept: d.concept, title: d.title, description: d.description, tags: d.tags, alt_text: d.alt_text, image_prompt: d.image_prompt,
});

export function SavedDrafts({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const [drafts, setDrafts] = useState<PinDraft[] | null>(null);
  const [edits, setEdits] = useState<Record<string, DraftContent>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    Promise.all([store.listDrafts(workspace.id), store.listCategories(workspace.id)])
      .then(([d, c]) => {
        setDrafts(d);
        setCategories(c);
      })
      .catch((e: Error) => setMsg({ id: "", text: e.message, ok: false }));
  }, [store, workspace]);

  if (wsError) return <p className="text-red-700">Could not load workspace: {wsError}</p>;
  if (!store || !workspace || !drafts) return <p className="text-zinc-500">Loading drafts…</p>;

  async function saveEdit(d: PinDraft) {
    const e = edits[d.id];
    if (!e || !store || !workspace) return;
    if (draftErrors(e).length) return setMsg({ id: d.id, text: "Fix the highlighted fields first.", ok: false });
    try {
      const updated = await store.updateDraft(workspace.id, d.id, e);
      setDrafts((all) => all!.map((x) => (x.id === d.id ? updated : x)));
      setEdits((all) => {
        const rest = { ...all };
        delete rest[d.id];
        return rest;
      });
      setMsg({ id: d.id, text: "Saved.", ok: true });
    } catch (err) {
      setMsg({ id: d.id, text: (err as Error).message, ok: false });
    }
  }

  async function remove(d: PinDraft) {
    if (!store || !workspace) return;
    try {
      await store.deleteDraft(workspace.id, d.id);
      setDrafts((all) => all!.filter((x) => x.id !== d.id));
    } catch (err) {
      setMsg({ id: d.id, text: (err as Error).message, ok: false });
    }
  }

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{WORKSPACE_LABELS[kind]} · saved drafts ({drafts.length})</h1>
      {store.mode === "demo" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Demo storage: these drafts live only in this browser and are not synced anywhere.
        </p>
      )}
      {drafts.length === 0 && <p className="text-zinc-600">No saved drafts yet. Generate some in the Studio.</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {drafts.map((d, i) => {
          const current = edits[d.id] ?? pick(d);
          return (
            <div key={d.id} className="flex flex-col gap-1">
              <p className="text-xs text-zinc-500">
                Idea: “{d.idea}”{catName(d.category_id) ? ` · ${catName(d.category_id)}` : ""} · Status: {d.status} · {new Date(d.created_at).toLocaleString()}
              </p>
              <DraftEditor
                index={i}
                draft={current}
                source={d.source}
                imageStatus={d.image_status}
                onChange={(nd) => setEdits((all) => ({ ...all, [d.id]: nd }))}
                media={
                  <DraftImage
                    kind={kind}
                    store={store}
                    draft={d}
                    promptDirty={Boolean(edits[d.id] && edits[d.id].image_prompt !== d.image_prompt)}
                    onUpdated={(u) => setDrafts((all) => all!.map((x) => (x.id === u.id ? u : x)))}
                  />
                }
                footer={
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => saveEdit(d)}
                      disabled={!edits[d.id]}
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                    >
                      Save changes
                    </button>
                    <button onClick={() => remove(d)} className="text-sm text-red-700 hover:underline">Delete draft</button>
                    {msg?.id === d.id && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
                  </div>
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
