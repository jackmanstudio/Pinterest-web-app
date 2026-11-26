"use client";
import { LIMITS, parseList } from "@/lib/drafts/validation";
import type { QualityContext } from "@/lib/drafts/quality";
import type { ContentSource, DraftContent, ImageStatus } from "@/lib/types";
import { CopyButton, pinAsText } from "./CopyButton";
import { QualityPanel } from "./QualityPanel";

const IMAGE_LABEL: Record<ImageStatus, string> = {
  not_generated: "No image yet",
  pending: "Generating…",
  ready: "Ready",
  failed: "Failed",
};

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return <span className={`text-xs ${over ? "font-semibold text-red-600" : "text-zinc-500"}`}>{value.length}/{max}</span>;
}

export function SourceBadge({ source, what = "text" }: { source: ContentSource; what?: "text" | "image" }) {
  if (source === "demo")
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
        {what === "image" ? "DEMO — placeholder image, not AI" : "DEMO — template text, not AI"}
      </span>
    );
  // Real AI output needs no badge; only placeholders and templates are labelled.
  if (source === "ai") return null;
  return <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-700">Manual</span>;
}

export function draftErrors(d: DraftContent): string[] {
  const e: string[] = [];
  if (!d.title.trim()) e.push("Title is required");
  if (d.title.length > LIMITS.title) e.push(`Title is over ${LIMITS.title} characters`);
  if (d.description.length > LIMITS.description) e.push(`Description is over ${LIMITS.description} characters`);
  if (d.alt_text.length > LIMITS.alt_text) e.push(`Alt text is over ${LIMITS.alt_text} characters`);
  if (d.tags.length > LIMITS.tags) e.push(`Use at most ${LIMITS.tags} tags`);
  return e;
}

interface Props {
  index: number;
  draft: DraftContent;
  source: ContentSource;
  imageStatus?: ImageStatus;
  onChange: (d: DraftContent) => void;
  footer?: React.ReactNode;
  /** Optional image area (preview + generate button) for saved drafts. */
  media?: React.ReactNode;
  /** Brand rules and link used by the quality check. */
  quality?: QualityContext;
  /** "card": image on top, then the main text, with the rest folded under "More details" (Pin library). */
  layout?: "form" | "card";
  /** Small line under the image in card layout (status, category, date). */
  meta?: React.ReactNode;
}

export function DraftEditor({ index, draft, source, imageStatus = "not_generated", onChange, footer, media, quality, layout = "form", meta }: Props) {
  const set = <K extends keyof DraftContent>(k: K, v: DraftContent[K]) => onChange({ ...draft, [k]: v });
  const id = (f: string) => `d${index}-${f}`;
  const input = "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-600 focus:outline-none";
  const errors = draftErrors(draft);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Pin {index + 1} · {draft.angle || "Custom"}
      </span>
      <span className="flex items-center gap-2">
        <CopyButton text={pinAsText({ ...draft, link: quality?.link })} label="Copy whole pin" />
        <SourceBadge source={source} />
      </span>
    </div>
  );
  const concept = (
    <>
      <label className="text-xs font-medium text-zinc-700" htmlFor={id("concept")}>Concept</label>
      <textarea id={id("concept")} className={input} rows={2} value={draft.concept} onChange={(e) => set("concept", e.target.value)} />
    </>
  );
  const main = (
    <>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("title")}>Title</label>
        <span className="flex gap-2"><CopyButton text={draft.title} /><Counter value={draft.title} max={LIMITS.title} /></span>
      </div>
      <input id={id("title")} className={input} value={draft.title} onChange={(e) => set("title", e.target.value)} />

      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("desc")}>Description</label>
        <span className="flex gap-2"><CopyButton text={draft.description} /><Counter value={draft.description} max={LIMITS.description} /></span>
      </div>
      <textarea id={id("desc")} className={input} rows={4} value={draft.description} onChange={(e) => set("description", e.target.value)} />

      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("tags")}>Tags (comma separated, max {LIMITS.tags})</label>
        <CopyButton text={draft.tags.join(", ")} />
      </div>
      <input
        id={id("tags")}
        className={input}
        defaultValue={draft.tags.join(", ")}
        onBlur={(e) => set("tags", parseList(e.target.value))}
      />
    </>
  );
  const extra = (
    <>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("alt")}>Alt text</label>
        <span className="flex gap-2"><CopyButton text={draft.alt_text} /><Counter value={draft.alt_text} max={LIMITS.alt_text} /></span>
      </div>
      <textarea id={id("alt")} className={input} rows={2} value={draft.alt_text} onChange={(e) => set("alt_text", e.target.value)} />

      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("img")}>Image prompt</label>
        <CopyButton text={draft.image_prompt} />
      </div>
      <textarea id={id("img")} className={input} rows={3} value={draft.image_prompt} onChange={(e) => set("image_prompt", e.target.value)} />

      <p className="text-xs text-zinc-600">
        <span className="font-medium">Image status:</span> {IMAGE_LABEL[imageStatus]}
      </p>
    </>
  );
  const tail = (
    <>
      <QualityPanel draft={draft} ctx={quality} />
      {errors.length > 0 && (
        <ul className="rounded-md bg-red-50 p-2 text-xs text-red-700" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {footer}
    </>
  );

  if (layout === "card") {
    return (
      <article className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:border-zinc-300">
        {media && <div className="p-2.5 pb-0">{media}</div>}
        <div className="flex flex-col gap-3 p-4">
          {meta}
          {header}
          {main}
          <details className="group rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
            <summary className="cursor-pointer list-none text-[13px] font-semibold text-zinc-700 marker:hidden">
              <span className="inline-block transition group-open:rotate-90" aria-hidden>›</span> More details
              <span className="font-normal text-zinc-500"> · concept, alt text, image prompt</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {concept}
              {extra}
            </div>
          </details>
          {tail}
        </div>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      {header}
      {concept}
      {main}
      {extra}
      {media}
      {tail}
    </article>
  );
}
