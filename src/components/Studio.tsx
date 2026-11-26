"use client";
import { PageTitle } from "./PageTitle";
import { autoPlanBoards } from "@/lib/client/boards";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandSettings, Category, DraftContent, GenerateResponse, PinDraft, WorkspaceKind } from "@/lib/types";
import { detectCategory } from "@/lib/categories/taxonomy";
import type { DesignReport } from "@/lib/brand/check";
import { LANGUAGES } from "@/lib/brand/languages";
import { WORKSPACE_LABELS } from "@/lib/types";
import { generateDraftImage, runPool } from "@/lib/client/pinImages";
import { DraftEditor, draftErrors, SourceBadge } from "./DraftEditor";
import { useWorkspace } from "./useWorkspace";
import { useTrendKeywords } from "@/lib/client/useTrendKeywords";
import { AutoPinCard } from "./AutoPinCard";
import { TrendIdeas } from "./TrendIdeas";
import { downloadImage } from "@/lib/client/download";
import { pageContext, type PageInfo } from "@/lib/tools/pageExtract";
import { PIN_STYLES, PIN_STYLE_KEYS, type PinStyle } from "@/lib/drafts/angles";

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
  designs: Record<string, DesignReport>;
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
  const trendKeywords = useTrendKeywords(kind);
  const [categories, setCategories] = useState<Category[]>([]);
  // ?idea=… pre-fills the box (used by "Make new versions" on Analytics).
  const [idea, setIdea] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("idea") ?? "").slice(0, 500)));
  const [categoryId, setCategoryId] = useState<string>("");
  const [catMode, setCatMode] = useState<"auto" | "manual" | "custom">("auto");
  const [customCat, setCustomCat] = useState("");
  const [saveCustom, setSaveCustom] = useState(true);
  const [language, setLanguage] = useState("");
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [count, setCount] = useState(3);
  const [customCount, setCustomCount] = useState(false);
  const [busy, setBusy] = useState<"idle" | "generating" | "saving" | "auto">("idle");
  const [auto, setAuto] = useState<AutoRun | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  // "From a link": read a blog post or product page and turn it into pins.
  const [source, setSource] = useState<"idea" | "link">("idea");
  const [style, setStyle] = useState<PinStyle>("mixed");
  const [pageUrl, setPageUrl] = useState("");
  const [page, setPage] = useState<PageInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [usePhotos, setUsePhotos] = useState(true);

  async function readPage() {
    setReading(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/read-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: pageUrl }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that page.");
      const p = body.page as PageInfo;
      setPage(p);
      setIdea(p.title.slice(0, 500));
      setLink(p.canonical ?? p.url);
      setPhotos(p.images.slice(0, 5).map((i) => i.url));
      setUsePhotos(p.images.length > 0);
    } catch (e) {
      setPage(null);
      setError({ message: (e as Error).message, retryable: true });
    } finally {
      setReading(false);
    }
  }

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
    // ?from=<draft id> (a fresh version of a published pin): keep its link and category.
    const from = new URLSearchParams(window.location.search).get("from");
    if (from && /^[0-9a-f-]{36}$/i.test(from)) {
      store
        .getDraft(workspace.id, from)
        .then((d) => {
          if (d.link) setLink(d.link);
          if (d.category_id) {
            setCatMode("manual");
            setCategoryId(d.category_id);
          }
        })
        .catch(() => {});
    }
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
        body: JSON.stringify({ workspace: kind, idea, category, language: language || undefined, brand, context: source === "link" && page ? pageContext(page) : undefined, style }),
        // Never leave the user on "Writing pins…" forever.
        signal: AbortSignal.timeout(150_000),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError")
        throw new GenerateError("Writing the pins took more than 2½ minutes, so it was stopped. Please retry; pins in Urdu and other non-English languages take longer.", true);
      throw new GenerateError("Could not reach the server. Check your connection and retry.", true);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new GenerateError(body.error ?? "Generation failed", Boolean(body.retryable));
    const result = body as Batch["result"];
    // Exactly the number of pins asked for. The angles come in a fixed order, so
    // every pin in the set gets a different creative angle and a different layout.
    return { ...result, drafts: result.drafts.slice(0, count) };
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
    let run: AutoRun = { phase: "writing", idea: theIdea, result: null, drafts: [], imageErrors: {}, imagesDone: 0, designs: {} };
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
      // Plan a board for each new pin in the background (spec 11). Failures never block pin making.
      autoPlanBoards(store, workspace.id, kind, saved).catch(() => {});
      setIdea("");
      const pagePhotos = source === "link" && page && usePhotos ? photos : [];
      await runPool(
        saved,
        // Store sites often refuse several photo downloads at once: fetch page photos one at a time.
        pagePhotos.length ? 1 : 2,
        (d, i) => generateDraftImage(kind, store, d, pagePhotos.length ? { sourceImage: pagePhotos[i % pagePhotos.length], sourcePage: page?.url } : {}),
        (r) =>
          update({
            drafts: run.drafts.map((x) => (x.id === r.draft.id ? r.draft : x)),
            imageErrors: r.error ? { ...run.imageErrors, [r.draft.id]: r.error } : run.imageErrors,
            imagesDone: run.imagesDone + 1,
            designs: r.design ? { ...run.designs, [r.draft.id]: r.design } : run.designs,
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
    setAuto((a) => a && { ...a, drafts: a.drafts.map((x) => (x.id === d.id ? r.draft : x)), imageErrors: r.error ? { ...a.imageErrors, [d.id]: r.error } : a.imageErrors, designs: r.design ? { ...a.designs, [d.id]: r.design } : a.designs });
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
      const savedDrafts = await store.saveDrafts(
        workspace.id,
        chosen.map((d) => ({ ...d, idea: batch.idea, batch_id: batch.id, category_id: batch.categoryId, source: batch.result.source, link: cleanLink || null })),
      );
      autoPlanBoards(store, workspace.id, kind, savedDrafts).catch(() => {});
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
      <PageTitle kind={kind} title="Create" accent="pins" sub="Type an idea and get finished pins with title, description, tags and image. They are saved as drafts; nothing goes to Pinterest until you approve it." />
      <section className="au-glass rounded-2xl p-5 sm:p-6">
        <div className="flex rounded-[0.875rem] bg-white/[0.05] p-1 text-sm ring-1 ring-white/10 sm:inline-flex" role="radiogroup" aria-label="Start from">
          {(["idea", "link"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={source === m}
              onClick={() => setSource(m)}
              className={`flex-1 whitespace-nowrap rounded-[0.6rem] px-4 py-2 font-semibold transition ${source === m ? "bg-white/[0.14] text-white shadow" : "text-white/60 hover:text-white"}`}
            >
              {m === "idea" ? "From an idea" : <>From a link<span className="hidden sm:inline"> (blog post or product)</span></>}
            </button>
          ))}
        </div>
        {source === "link" && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                readPage();
              }}
            >
              <label className="sr-only" htmlFor="page-url">Page address</label>
              <input id="page-url" type="url" inputMode="url" className="au-field h-11 w-full min-w-0 px-4 text-sm sm:flex-1" placeholder="https://yourblog.com/post or a product page" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} />
              <button disabled={reading || pageUrl.trim().length < 4} className="h-11 rounded-[0.875rem] bg-white/[0.1] px-5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/[0.16] disabled:opacity-50">{reading ? "Reading…" : "Read page"}</button>
            </form>
            {page && (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  <span className="mr-2 rounded bg-white px-1.5 py-0.5 text-xs font-medium capitalize text-zinc-700 ring-1 ring-zinc-200">{page.kind}</span>
                  <strong>{page.title}</strong>
                  {page.price && <span className="ml-2 text-zinc-600">· {page.price}</span>}
                </p>
                {page.description && <p className="text-zinc-600">{page.description}</p>}
                {page.images.length > 0 ? (
                  <>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={usePhotos} onChange={(e) => setUsePhotos(e.target.checked)} />
                      Use photos from this page ({photos.length} picked). Use only photos you have the rights to. Untick to let AI make new images.
                    </label>
                    {usePhotos && (
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Page photos">
                        {page.images.map((im) => {
                          const on = photos.includes(im.url);
                          return (
                            <button
                              key={im.url}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setPhotos((ps) => (on ? ps.filter((u) => u !== im.url) : [...ps, im.url]))}
                              className={`relative h-20 w-16 overflow-hidden rounded-md ring-2 ${on ? "ring-red-700" : "ring-transparent opacity-60"}`}
                              title={im.alt || "Page photo"}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- external page photo preview */}
                              <img src={im.url} alt={im.alt} className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                              {on && <span className="absolute right-0.5 top-0.5 rounded-full bg-red-700 px-1 text-[10px] text-white">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-zinc-500">No usable photos on this page, so AI will make the images.</p>
                )}
                <p className="text-xs text-zinc-500">The title below and the link are filled in from the page. Pins only use facts from the page.</p>
              </div>
            )}
          </div>
        )}
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
            className="au-field h-12 w-full min-w-0 px-4 text-[15px] sm:flex-1"
            placeholder={kind === "fashion" ? "e.g. Layering a trench coat for autumn" : "Describe your pin idea"}
            value={idea}
            maxLength={500}
            onChange={(e) => setIdea(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy !== "idle" || idea.trim().length < 3}
            className={`inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[0.875rem] bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-6 text-[15px] font-bold text-white shadow-[0_10px_28px_-12px_rgba(255,90,60,0.95)] transition hover:brightness-110 disabled:cursor-not-allowed ${idea.trim().length < 3 && busy === "idle" ? "disabled:opacity-80 disabled:saturate-[0.85]" : "disabled:opacity-60"}`}
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>
            {busy === "auto" ? "Making pins…" : `Make ${count} complete pin${count === 1 ? "" : "s"}`}
          </button>
        </form>
        <div className="mt-5 divide-y divide-white/[0.07] rounded-xl bg-white/[0.03] ring-1 ring-white/10">
          <OptRow label="How many pins" hint="Each pin gets its own angle, layout and colour story.">
            <Seg
              label="Number of pins"
              options={[
                ...[2, 3, 5].map((n) => ({ value: String(n), label: `${n} pins` })),
                { value: "custom", label: "Custom" },
              ]}
              value={customCount ? "custom" : String(count)}
              onChange={(v) => {
                if (v === "custom") setCustomCount(true);
                else {
                  setCustomCount(false);
                  setCount(Number(v));
                }
              }}
            />
            {customCount && (
              <GlassSelect label="Custom number of pins" value={String(count)} onChange={(v) => setCount(Number(v))} className="w-32">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "pin" : "pins"}</option>
                ))}
              </GlassSelect>
            )}
          </OptRow>
          <OptRow label="Pin type" htmlFor="pin-style" hint={PIN_STYLES[style].hint}>
            <GlassSelect id="pin-style" value={style} onChange={(v) => setStyle(v as PinStyle)} className="w-full sm:w-64">
              {PIN_STYLE_KEYS.map((k) => (
                <option key={k} value={k}>{PIN_STYLES[k].label}</option>
              ))}
            </GlassSelect>
          </OptRow>
          <OptRow
            label="Category"
            hint={
              catMode === "auto" ? (
                <span aria-live="polite">
                  {idea.trim().length < 3
                    ? "Type a title and the best category is picked for you."
                    : detected
                      ? <>Detected: <strong className="text-white/85">{pathOf(detected.category)}</strong> (matched “{detected.matched.slice(0, 3).join("”, “")}”). <button type="button" className="font-semibold text-[#ff9a7a] hover:underline" onClick={() => { setCategoryId(detected.category.id); setCatMode("manual"); }}>Change</button></>
                      : "No clear match; pins will be made without a category. Use Choose or Custom to set one."}
                </span>
              ) : undefined
            }
          >
            <Seg
              label="Category mode"
              options={[{ value: "auto", label: "Automatic" }, { value: "manual", label: "Choose" }, { value: "custom", label: "Custom" }]}
              value={catMode}
              onChange={(v) => setCatMode(v as typeof catMode)}
            />
            {catMode === "manual" && (
              <GlassSelect id="category" label="Category" value={categoryId} onChange={setCategoryId} className="w-full sm:w-64">
                <option value="">No category</option>
                {categories
                  .filter((c) => !c.parent_id)
                  .flatMap((c) => [c, ...categories.filter((s) => s.parent_id === c.id)])
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.parent_id ? `   ${pathOf(c)}` : c.name}</option>
                  ))}
              </GlassSelect>
            )}
            {catMode === "custom" && (
              <>
                <input aria-label="Custom category" className="au-field h-10 w-full px-3.5 text-sm sm:w-56" placeholder="e.g. Eid outfits" maxLength={80} value={customCat} onChange={(e) => setCustomCat(e.target.value)} />
                <label className="flex items-center gap-2 text-[13px] text-white/70">
                  <input type="checkbox" className="h-4 w-4" checked={saveCustom} onChange={(e) => setSaveCustom(e.target.checked)} /> Save to {WORKSPACE_LABELS[kind]} categories
                </label>
              </>
            )}
          </OptRow>
          <OptRow label="Language" htmlFor="pin-language">
            <GlassSelect id="pin-language" value={language} onChange={setLanguage} className="w-full sm:w-64">
              <option value="">English</option>
              {LANGUAGES.filter((l) => l !== "English").map((l) => <option key={l} value={l}>{l}</option>)}
            </GlassSelect>
          </OptRow>
          <OptRow label="Link on these pins" htmlFor="pin-link" hint="Optional. Pins with a link can send clicks to your site.">
            <input
              id="pin-link"
              type="url"
              className="au-field h-10 w-full px-3.5 text-sm"
              placeholder="https://your-blog.com/post or a product page"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </OptRow>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={generate}
            disabled={busy !== "idle" || idea.trim().length < 3}
            className="inline-flex h-10 items-center gap-2 rounded-[0.75rem] bg-white/[0.06] px-4 text-[13px] font-semibold text-white/85 ring-1 ring-white/12 transition hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
            {busy === "generating" ? `Writing ${count} draft${count === 1 ? "" : "s"}…` : "Write text only"}
          </button>
          <span className="text-xs text-white/45">Text first, so you can edit before saving. No images are made.</span>
        </div>
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
              {auto.phase === "writing" && `Writing ${count} pin${count === 1 ? "" : "s"}…${language && !/^(english|roman)/i.test(language) ? " Pins in " + language + " can take 1–2 minutes." : ""}`}
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
                <AutoPinCard key={d.id} store={store!} draft={d} design={auto.designs[d.id]} error={auto.imageErrors[d.id]} onRetry={() => retryImage(d)} disabled={busy !== "idle"} />
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
                quality={{ bannedWords: brand?.banned_words, focusKeywords: brand?.focus_keywords, trendKeywords, today: new Date(), idea: batch.idea, link: normalizeLink(link) || null }}
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

/** One option row: label on the left (top on phones), controls and a hint under them. */
function OptRow({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-5">
      <label htmlFor={htmlFor} className="pt-2 text-[13.5px] font-semibold text-white/85 sm:pt-2.5">{label}</label>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">{children}</div>
        {hint && <p className="text-[12.5px] leading-snug text-white/50">{hint}</p>}
      </div>
    </div>
  );
}

/** Segmented control in the glass style, same height as the selects next to it. */
function Seg({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-10 max-w-full gap-1 overflow-x-auto rounded-[0.75rem] bg-white/[0.05] p-1 ring-1 ring-white/12">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`whitespace-nowrap rounded-[0.55rem] px-3.5 text-[13px] font-semibold transition ${value === o.value ? "bg-white/[0.16] text-white shadow" : "text-white/60 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GlassSelect({ id, label, value, onChange, className = "", children }: { id?: string; label?: string; value: string; onChange: (v: string) => void; className?: string; children: React.ReactNode }) {
  return (
    <span className={`relative flex items-center ${className}`}>
      <select id={id} aria-label={label} className="au-field h-10 w-full min-w-0 appearance-none truncate pl-3.5 pr-9 text-[13.5px] font-medium" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-3 h-4 w-4 text-white/55" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </span>
  );
}
