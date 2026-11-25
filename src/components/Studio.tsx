"use client";
import { useEffect, useState } from "react";
import type { Category, DraftContent, GenerateResponse, WorkspaceKind } from "@/lib/types";
import { WORKSPACE_LABELS } from "@/lib/types";
import { DraftEditor, draftErrors } from "./DraftEditor";
import { useWorkspace } from "./useWorkspace";

interface Batch {
  id: string;
  idea: string;
  categoryId: string | null;
  result: GenerateResponse & { warnings?: string[] };
  drafts: DraftContent[];
  selected: boolean[];
}

export function Studio({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error: wsError } = useWorkspace(kind);
  const [categories, setCategories] = useState<Category[]>([]);
  const [idea, setIdea] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [busy, setBusy] = useState<"idle" | "generating" | "saving">("idle");
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    store.listCategories(workspace.id).then(setCategories).catch((e: Error) => setError({ message: e.message, retryable: false }));
  }, [store, workspace]);

  async function generate() {
    if (!store || !workspace) return;
    setBusy("generating");
    setError(null);
    setNotice(null);
    try {
      const brand = await store.getBrand(workspace.id);
      const category = categories.find((c) => c.id === categoryId)?.name;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, idea, category, brand }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError({ message: body.error ?? "Generation failed", retryable: Boolean(body.retryable) });
        return;
      }
      const result = body as Batch["result"];
      setBatch({
        id: crypto.randomUUID(),
        idea: idea.trim(),
        categoryId: categoryId || null,
        result,
        drafts: result.drafts,
        selected: result.drafts.map(() => true),
      });
    } catch {
      setError({ message: "Could not reach the server. Check your connection and retry.", retryable: true });
    } finally {
      setBusy("idle");
    }
  }

  async function save() {
    if (!store || !workspace || !batch) return;
    const chosen = batch.drafts.filter((_, i) => batch.selected[i]);
    if (chosen.some((d) => draftErrors(d).length)) {
      setError({ message: "Fix the highlighted fields before saving.", retryable: false });
      return;
    }
    setBusy("saving");
    setError(null);
    try {
      await store.saveDrafts(
        workspace.id,
        chosen.map((d) => ({ ...d, idea: batch.idea, batch_id: batch.id, category_id: batch.categoryId, source: batch.result.source })),
      );
      setNotice(
        `Saved ${chosen.length} draft${chosen.length === 1 ? "" : "s"} to ${WORKSPACE_LABELS[kind]}${store.mode === "demo" ? " (Demo storage: this browser only)" : ""}.`,
      );
      setBatch(null);
      setIdea("");
    } catch (e) {
      setError({ message: (e as Error).message, retryable: true });
    } finally {
      setBusy("idle");
    }
  }

  if (wsError) return <p className="text-red-700">Could not load workspace: {wsError}</p>;
  if (!workspace) return <p className="text-zinc-500">Loading workspace…</p>;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">{WORKSPACE_LABELS[kind]} studio</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Enter a pin idea to get five distinct drafts. Edit them, then save the ones you want. Images are generated from saved drafts.
        </p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            generate();
          }}
        >
          <label className="sr-only" htmlFor="idea">Pin idea</label>
          <input
            id="idea"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2"
            placeholder={kind === "fashion" ? "e.g. Layering a trench coat for autumn" : "Describe your pin idea"}
            value={idea}
            maxLength={500}
            onChange={(e) => setIdea(e.target.value)}
          />
          <label className="sr-only" htmlFor="category">Category</label>
          <select id="category" className="rounded-md border border-zinc-300 px-3 py-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy !== "idle" || idea.trim().length < 3}
            className="rounded-md bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy === "generating" ? "Generating 5 drafts…" : "Generate 5 drafts"}
          </button>
        </form>
        {error && (
          <div className="mt-3 flex items-center gap-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">
            <span>{error.message}</span>
            {error.retryable && (
              <button className="underline" onClick={batch ? save : generate}>Retry</button>
            )}
          </div>
        )}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{notice}</p>}
      </section>

      {batch && (
        <section className="flex flex-col gap-4">
          {batch.result.source === "demo" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Demo output.</strong> No text AI key is configured, so these drafts come from fixed templates, not AI. Add
              <code className="mx-1">TEXT_AI_API_KEY</code> on the server for real generation.
            </p>
          )}
          {batch.result.source === "ai" && (
            <p className="text-sm text-zinc-600">
              Generated by {batch.result.provider}
              {batch.result.model ? ` (${batch.result.model})` : ""}
              {batch.result.usage ? ` · ${batch.result.usage.input_tokens} in / ${batch.result.usage.output_tokens} out tokens` : ""}
              {typeof batch.result.est_cost_usd === "number" ? ` · est. $${batch.result.est_cost_usd.toFixed(4)}` : ""}
            </p>
          )}
          {batch.result.warnings?.map((w) => (
            <p key={w} className="text-sm text-amber-800">{w}</p>
          ))}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {batch.drafts.map((d, i) => (
              <DraftEditor
                key={`${batch.id}-${i}`}
                index={i}
                draft={d}
                source={batch.result.source}
                onChange={(nd) => setBatch({ ...batch, drafts: batch.drafts.map((x, j) => (j === i ? nd : x)) })}
                footer={
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={batch.selected[i]}
                      onChange={(e) => setBatch({ ...batch, selected: batch.selected.map((s, j) => (j === i ? e.target.checked : s)) })}
                    />
                    Include when saving
                  </label>
                }
              />
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={busy !== "idle" || !batch.selected.some(Boolean)}
              className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {busy === "saving" ? "Saving…" : `Save ${batch.selected.filter(Boolean).length} selected`}
            </button>
            <button onClick={() => setBatch(null)} className="rounded-md px-4 py-2 text-zinc-700 hover:bg-zinc-100">Discard</button>
          </div>
        </section>
      )}
    </div>
  );
}
