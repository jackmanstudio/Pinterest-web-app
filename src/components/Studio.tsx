"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandSettings, Category, DraftContent, GenerateResponse, PinDraft, WorkspaceKind } from "@/lib/types";
import { detectCategory } from "@/lib/categories/taxonomy";
import { LANGUAGES } from "@/lib/brand/languages";
import { WORKSPACE_LABELS } from "@/lib/types";
import { generateDraftImage, runPool } from "@/lib/client/pinImages";
import { DraftEditor, draftErrors, SourceBadge } from "./DraftEditor";
import { useWorkspace } from "./useWorkspace";
import { AutoPinCard } from "./AutoPinCard";
import { TrendIdeas } from "./TrendIdeas";
import { downloadImage } from "@/lib/client/download";

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
  const [catMode, setCatMode] = useState<"auto" | "manual" | "custom">("auto");
  const [customCat, setCustomCat] = useState("");
  const [saveCustom, setSaveCustom] = useState(true);
  const [language, setLanguage] = useState("");
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [busy, setBusy] = useState<"idle" | "generating" | "saving" | "auto">("idle");
  const [auto, setAuto] = useState<AutoRun | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    store.listCategories(workspace.id).then(setCategories).catch((e: Error) => setError({ message: e.message, retryable: false }));
    store
      .getBrand(workspace.id)
      .then((b) => {
        setBrand(b);
        setLink((l) => l || b.website_url);
        setLanguage((l) => l || b.language || "");
      })
      .catch(() => {});
  }, [store, workspace]);

  const detected = useMemo(() => (idea.trim().length >= 3 ? detectCategory(idea, categories) : null), [idea, categories]);
  const pathOf = (c: Category | undefined) => {
    if (!c) return undefined;
    const parent = c.parent_id ? categories.find((p) => p.id === c.parent_id) : null;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };

  /** Applies the category mode: automatic (detected), manual (picked) or custom (typed, optionally saved). */
  async function resolveCategory(): Promise<{ id: string | null; label?: string }> {
    if (catMode === "auto") return detected ? { id: detected.category.id, label: pathOf(detected.category) } : { id: null };
    if (catMode === "manual") {
      const c = categories.find((x) => x.id === categoryId);
      return { id: c?.id ?? null, label: pathOf(c) };
    }
    const name = customCat.trim().slice(0, 80);
    if (!name) return { id: null };
    const existing = categories.find((c) => !c.parent_id && c.name.toLowerCase() === name.toLowerCase());
    if (existing) return { id: existing.id, label: existing.name };
    if (!saveCustom) return { id: null, label: name };
    const created = await store!.addCategory(workspace!.id, name);
    setCategories((all) => [...all, created]);
    return { id: created.id, label: created.name };
  }

  async function requestDrafts(category?: string): Promise<Batch["result"]> {
    const brand = await store!.getBrand(workspace!.id);
    let res: Response;
    try {
      res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, idea, category, language: language || undefined, brand }),
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
      const cat = await resolveCategory();
      const result = await requestDrafts(cat.label);
      setBatch({
        id: crypto.randomUUID(),
        idea: idea.trim(),
        categoryId: cat.id,
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
      const cat = await resolveCategory();
      const result = await requestDrafts(cat.label);
      update({ phase: "saving", result });
      const batchId = crypto.randomUUID();
      const saved = await store.saveDrafts(
        workspace.id,
        result.drafts.map((d) => ({ ...d, idea: theIdea, batch_id: batchId, category_id: cat.id, source: result.source, link: cleanLink })),
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
          <button
            type="submit"
            disabled={busy !== "idle" || idea.trim().length < 3}
            className="rounded-md bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy === "auto" ? "Making pins…" : "Make 5 complete pins"}
          </button>
        </form>
        <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-700 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span className="font-medium">Category</span>
          <div className="flex rounded-md bg-zinc-100 p-0.5" role="radiogroup" aria-label="Category mode">
            {(["auto", "manual", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={catMode === m}
                onClick={() => setCatMode(m)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${catMode === m ? "bg-white shadow-sm" : "text-zinc-600"}`}
              >
                {m === "auto" ? "Automatic" : m === "manual" ? "Choose" : "Custom"}
              </button>
            ))}
          </div>
          {catMode === "auto" && (
            <span className="text-xs text-zinc-600" aria-live="polite">
              {idea.trim().length < 3
                ? "Type a title and the best category is picked for you."
                : detected
                  ? <>Detected: <strong>{pathOf(detected.category)}</strong> (matched “{detected.matched.slice(0, 3).join("”, “")}”). <button type="button" className="underline" onClick={() => { setCategoryId(detected.category.id); setCatMode("manual"); }}>Change</button></>
                  : "No clear match; pins will be made without a category. Use Choose or Custom to set one."}
            </span>
          )}
          {catMode === "manual" && (
            <select id="category" aria-label="Category" className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories
                .filter((c) => !c.parent_id)
                .flatMap((c) => [c, ...categories.filter((s) => s.parent_id === c.id)])
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.parent_id ? `   ${pathOf(c)}` : c.name}</option>
                ))}
            </select>
          )}
          {catMode === "custom" && (
            <>
              <input aria-label="Custom category" className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm" placeholder="e.g. Eid outfits" maxLength={80} value={customCat} onChange={(e) => setCustomCat(e.target.value)} />
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={saveCustom} onChange={(e) => setSaveCustom(e.target.checked)} /> Save to {WORKSPACE_LABELS[kind]} categories
              </label>
            </>
          )}
          <label className="flex items-center gap-2 sm:ml-auto">
            <span className="font-medium">Language</span>
            <select className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">English</option>
              {LANGUAGES.filter((l) => l !== "English").map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
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
                Edit in Pin library
              </Link>
              {auto.drafts.some((d) => d.image_status === "ready") && (
                <button
                  type="button"
                  onClick={async () => {
                    for (const d of auto.drafts.filter((x) => x.image_status === "ready")) {
                      const url = await store!.imageUrl(d).catch(() => null);
                      if (url) await downloadImage(url, d.title).catch(() => {});
                    }
                  }}
                  className="rounded-md px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  Download all images
                </button>
              )}
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
                quality={{ bannedWords: brand?.banned_words, focusKeywords: brand?.focus_keywords, link: normalizeLink(link) || null }}
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
