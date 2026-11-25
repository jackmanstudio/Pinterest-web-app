"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Category, DraftContent, GenerateResponse, PinDraft, WorkspaceKind } from "@/lib/types";
import { WORKSPACE_LABELS } from "@/lib/types";
import { generateDraftImage, runPool } from "@/lib/client/pinImages";
import { DraftEditor, draftErrors, SourceBadge } from "./DraftEditor";
import { useWorkspace } from "./useWorkspace";
import { AutoPinCard } from "./AutoPinCard";
import { TrendIdeas } from "./TrendIdeas";

/** "" → null (no link); a valid http(s) URL → itself; anything else → false. */
function normalizeLink(raw: string): string | null | false {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.hostname.includes(".") ? u.toString() : false;
  } catch {
    return false;
  }
}

class GenerateError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

interface AutoRun {
  phase: "writing" | "saving" | "images" | "done";
  idea: string;
  result: GenerateResponse | null;
  drafts: PinDraft[];
  imageErrors: Record<string, string>;
  imagesDone: number;
}

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
  // ?idea=… pre-fills the box (used by "Make new versions" on Analytics).
  const [idea, setIdea] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("idea") ?? "").slice(0, 500)));
  const [categoryId, setCategoryId] = useState<string>("");
  const [busy, setBusy] = useState<"idle" | "generating" | "saving" | "auto">("idle");
  const [auto, setAuto] = useState<AutoRun | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    store.listCategories(workspace.id).then(setCategories).catch((e: Error) => setError({ message: e.message, retryable: false }));
    store.getBrand(workspace.id).then((b) => setLink((l) => l || b.website_url)).catch(() => {});
  }, [store, workspace]);

  async function requestDrafts(): Promise<Batch["result"]> {
    const brand = await store!.getBrand(workspace!.id);
    const category = categories.find((c) => c.id === categoryId)?.name;
    let res: Response;
    try {
      res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, idea, category, brand }),
      });
    } catch {
      throw new GenerateError("Could not reach the server. Check your connection and retry.", true);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GenerateError(body.error ?? "Generation failed", Boolean(body.retryable));
    return body as Batch["result"];
  }

  async function generate() {
    if (!store || !workspace) return;
    setBusy("generating");
    setError(null);
    setNotice(null);
    setAuto(null);
    try {
      const result = await requestDrafts();
      setBatch({
        id: crypto.randomUUID(),
        idea: idea.trim(),
        categoryId: categoryId || null,
        result,
        drafts: result.drafts,
        selected: result.drafts.map(() => true),
      });
    } catch (e) {
      setError({ message: (e as Error).message, retryable: e instanceof GenerateError && e.retryable });
    } finally {
      setBusy("idle");
    }
  }

  /** One step: title in, five saved pins with text and images out. Nothing is published. */
  async function makeAll() {
    if (!store || !workspace) return;
    const theIdea = idea.trim();
    const cleanLink = normalizeLink(link);
    if (cleanLink === false) return setError({ message: "The link must be a full web address starting with https://", retryable: false });
    setBusy("auto");
    setError(null);
    setNotice(null);
    setBatch(null);
    let run: AutoRun = { phase: "writing", idea: theIdea, result: null, drafts: [], imageErrors: {}, imagesDone: 0 };
    const update = (patch: Partial<AutoRun>) => {
      run = { ...run, ...patch };
      setAuto(run);
    };
    update({});
    try {
      const result = await requestDrafts();
      update({ phase: "saving", result });
      const batchId = crypto.randomUUID();
      const saved = await store.saveDrafts(
        workspace.id,
        result.drafts.map((d) => ({ ...d, idea: theIdea, batch_id: batchId, category_id: categoryId || null, source: result.source, link: cleanLink })),
      );
      update({ phase: "images", drafts: saved });
      setIdea("");
      await runPool(
        saved,
        2,
        (d) => generateDraftImage(kind, store, d),
        (r) =>
          update({
            drafts: run.drafts.map((x) => (x.id === r.draft.id ? r.draft : x)),
            imageErrors: r.error ? { ...run.imageErrors, [r.draft.id]: r.error } : run.imageErrors,
            imagesDone: run.imagesDone + 1,
          }),
      );
      update({ phase: "done" });
    } catch (e) {
      if (!run.drafts.length) setAuto(null);
      else update({ phase: "done" });
      setError({ message: (e as Error).message, retryable: e instanceof GenerateError && e.retryable });
    } finally {
      setBusy("idle");
    }
  }

  async function retryImage(d: PinDraft) {
    if (!store || !auto) return;
    setAuto({ ...auto, imageErrors: Object.fromEntries(Object.entries(auto.imageErrors).filter(([k]) => k !== d.id)) });
    const pending = { ...d, image_status: "pending" as const };
    setAuto((a) => a && { ...a, drafts: a.drafts.map((x) => (x.id === d.id ? pending : x)) });
    const r = await generateDraftImage(kind, store, d);
    setAuto((a) => a && { ...a, drafts: a.drafts.map((x) => (x.id === d.id ? r.draft : x)), imageErrors: r.error ? { ...a.imageErrors, [d.id]: r.error } : a.imageErrors });
  }

  async function save() {
    if (!store || !workspace || !batch) return;
    const chosen = batch.drafts.filter((_, i) => batch.selected[i]);
    if (chosen.some((d) => draftErrors(d).length)) {
      setError({ message: "Fix the highlighted fields before saving.", retryable: false });
      return;
    }
    const cleanLink = normalizeLink(link);
    if (cleanLink === false) return setError({ message: "The link must be a full web address starting with https://", retryable: false });
    setBusy("saving");
    setError(null);
    try {
      await store.saveDrafts(
        workspace.id,
        chosen.map((d) => ({ ...d, idea: batch.idea, batch_id: batch.id, category_id: batch.categoryId, source: batch.result.source, link: cleanLink || null })),
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
          Type a title or idea and get five complete pins: title, description, tags, alt text and image, saved as drafts. Nothing
          goes to Pinterest until you approve it in Review &amp; publish.
        </p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            makeAll();
          }}
        >
          <label className="sr-only" htmlFor="idea">Pin title or idea</label>
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
            {busy === "auto" ? "Making pins…" : "Make 5 complete pins"}
          </button>
        </form>
        <label className="mt-3 flex flex-col gap-1 text-sm text-zinc-700 sm:flex-row sm:items-center sm:gap-3">
          <span className="font-medium">Link on these pins</span>
          <input
            type="url"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
            placeholder="https://your-blog.com/post or a product page (optional)"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={busy !== "idle" || idea.trim().length < 3}
          className="mt-2 text-sm text-zinc-600 underline decoration-zinc-300 hover:text-zinc-900 disabled:opacity-50"
        >
          {busy === "generating" ? "Writing 5 drafts…" : "Or: write text only, so I can edit before saving"}
        </button>
        <TrendIdeas kind={kind} store={store!} workspaceId={workspace.id} onPick={setIdea} />
        {error && (
          <div className="mt-3 flex items-center gap-3 rounded-md bg-red-50 p-3 text-sm text-red-800" role="alert">
            <span>{error.message}</span>
            {error.retryable && (
              <button className="underline" onClick={batch ? save : auto ? makeAll : generate}>Retry</button>
            )}
          </div>
        )}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{notice}</p>}
      </section>

      {auto && (
        <section className="flex flex-col gap-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">“{auto.idea}”</h2>
            <span className="text-sm text-zinc-600">
              {auto.phase === "writing" && "Writing 5 pins…"}
              {auto.phase === "saving" && "Saving drafts…"}
              {auto.phase === "images" && `Making images: ${auto.imagesDone} of ${auto.drafts.length} done…`}
              {auto.phase === "done" &&
                `Done. ${auto.drafts.filter((d) => d.image_status === "ready").length} of ${auto.drafts.length} pins have images, saved as drafts in ${WORKSPACE_LABELS[kind]}.`}
            </span>
            {auto.result && <SourceBadge source={auto.result.source} />}
          </div>
          {auto.result?.source === "demo" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Demo output.</strong> Text comes from templates and images are placeholders until the AI keys are added on the server.
            </p>
          )}
          {auto.drafts.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {auto.drafts.map((d) => (
                <AutoPinCard key={d.id} store={store!} draft={d} error={auto.imageErrors[d.id]} onRetry={() => retryImage(d)} disabled={busy !== "idle"} />
              ))}
            </div>
          )}
          {auto.phase === "done" && (
            <div className="flex flex-wrap gap-3">
              <Link href={`/w/${kind}/publish`} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
                Review &amp; approve →
              </Link>
              <Link href={`/w/${kind}/drafts`} className="rounded-md px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100">
                Edit in Saved drafts
              </Link>
            </div>
          )}
        </section>
      )}

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
