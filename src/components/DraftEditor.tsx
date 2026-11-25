"use client";
import { LIMITS, parseList } from "@/lib/drafts/validation";
import type { ContentSource, DraftContent, ImageStatus } from "@/lib/types";

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
}

export function DraftEditor({ index, draft, source, imageStatus = "not_generated", onChange, footer, media }: Props) {
  const set = <K extends keyof DraftContent>(k: K, v: DraftContent[K]) => onChange({ ...draft, [k]: v });
  const id = (f: string) => `d${index}-${f}`;
  const input = "w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-600 focus:outline-none";
  const errors = draftErrors(draft);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Pin {index + 1} · {draft.angle || "Custom"}
        </span>
        <SourceBadge source={source} />
      </div>

      <label className="text-xs font-medium text-zinc-700" htmlFor={id("concept")}>Concept</label>
      <textarea id={id("concept")} className={input} rows={2} value={draft.concept} onChange={(e) => set("concept", e.target.value)} />

      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("title")}>Title</label>
        <Counter value={draft.title} max={LIMITS.title} />
      </div>
      <input id={id("title")} className={input} value={draft.title} onChange={(e) => set("title", e.target.value)} />

      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("desc")}>Description</label>
        <Counter value={draft.description} max={LIMITS.description} />
      </div>
      <textarea id={id("desc")} className={input} rows={4} value={draft.description} onChange={(e) => set("description", e.target.value)} />

      <label className="text-xs font-medium text-zinc-700" htmlFor={id("tags")}>Tags (comma separated, max {LIMITS.tags})</label>
      <input
        id={id("tags")}
        className={input}
        defaultValue={draft.tags.join(", ")}
        onBlur={(e) => set("tags", parseList(e.target.value))}
      />

      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-700" htmlFor={id("alt")}>Alt text</label>
        <Counter value={draft.alt_text} max={LIMITS.alt_text} />
      </div>
      <textarea id={id("alt")} className={input} rows={2} value={draft.alt_text} onChange={(e) => set("alt_text", e.target.value)} />

      <label className="text-xs font-medium text-zinc-700" htmlFor={id("img")}>Image prompt</label>
      <textarea id={id("img")} className={input} rows={3} value={draft.image_prompt} onChange={(e) => set("image_prompt", e.target.value)} />

      <p className="text-xs text-zinc-600">
        <span className="font-medium">Image status:</span> {IMAGE_LABEL[imageStatus]}
      </p>
      {media}

      {errors.length > 0 && (
        <ul className="rounded-md bg-red-50 p-2 text-xs text-red-700" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {footer}
    </article>
  );
}
