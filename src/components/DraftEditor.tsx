"use client";
import { useState } from "react";
import { LIMITS, parseList } from "@/lib/drafts/validation";
import type { QualityContext } from "@/lib/drafts/quality";
import type { ContentSource, DraftContent, ImageStatus } from "@/lib/types";
import { CopyButton, pinAsText } from "./CopyButton";
import { QualityPanel, QualityScoreCard, type ScoreFix } from "./QualityPanel";

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
  /** Card layout: who posts it and where, shown like a pin's account row. */
  owner?: { name: string; board?: string | null };
  /** Card layout: one-click fix under the score card's notes. */
  fix?: ScoreFix;
}

export function DraftEditor({ index, draft, source, imageStatus = "not_generated", onChange, footer, media, quality, layout = "form", meta, owner, fix }: Props) {
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

  const cardTail = (
    <>
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
  if (layout === "card") return <CardView {...{ index, draft, source, media, meta, quality, owner, fix, concept, main, extra, tail: cardTail }} />;

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

function domainOf(link?: string | null): string | null {
  if (!link) return null;
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Pin library card, laid out like a pin: image, title, description, link, account row, tags, then the score card. */
function CardView({ index, draft, source, media, meta, quality, owner, fix, concept, main, extra, tail }: {
  fix?: ScoreFix;
  index: number;
  draft: DraftContent;
  source: ContentSource;
  media?: React.ReactNode;
  meta?: React.ReactNode;
  quality?: QualityContext;
  owner?: { name: string; board?: string | null };
  concept: React.ReactNode;
  main: React.ReactNode;
  extra: React.ReactNode;
  tail: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const domain = domainOf(quality?.link);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.05] transition duration-200 hover:border-white/20 hover:bg-white/[0.07]">
      {media && <div className="p-2.5 pb-0">{media}</div>}
      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Pin fields, in the order Pinterest asks for them: Title, Description, Link, Board, Tagged topics */}
        <dl className="flex flex-col divide-y divide-white/[0.08] rounded-xl bg-white/[0.03] ring-1 ring-white/10">
          <Field label="Title">
            <h3 className="text-[17px] font-bold leading-snug tracking-tight text-white">{draft.title || "Untitled pin"}</h3>
          </Field>
          {!editing && (
            <Field label="Description">
              <span className="line-clamp-4 text-[13.5px] leading-relaxed text-white/75">{draft.description || "—"}</span>
            </Field>
          )}
          <Field label="Link">
            {domain ? (
              <a href={quality?.link ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 truncate text-[13.5px] font-semibold text-[#ff9a7a] hover:text-white hover:underline">
                <span aria-hidden>↗</span> <span className="truncate">{domain}</span>
              </a>
            ) : (
              <span className="text-[13.5px] text-white/45">No link yet</span>
            )}
          </Field>
          <Field label="Board">
            <span className="flex items-center gap-2">
              <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#e60023] to-[#ff7a45] text-[11px] font-bold text-white">{(owner?.board || owner?.name || "B").charAt(0).toUpperCase()}</span>
              <span className="truncate text-[13.5px] font-semibold text-white">{owner?.board || "Picked when you publish"}</span>
            </span>
          </Field>
          {!editing && (
            <Field label="Tagged topics">
              {draft.tags.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="Tagged topics">
                  {draft.tags.map((t) => (
                    <li key={t} className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[12px] font-medium text-white/80 ring-1 ring-white/10">{t}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-[13.5px] text-white/45">No topics yet</span>
              )}
            </Field>
          )}
        </dl>

        <QualityScoreCard draft={draft} ctx={quality} fix={fix} />

        {meta}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">Pin {index + 1} · {draft.angle || "Custom"}</span>
          <span className="ml-auto"><SourceBadge source={source} /></span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
            className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-[13px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/[0.14]"
          >
            {editing ? "Close editor" : "Edit text"}
          </button>
          <CopyButton text={pinAsText({ ...draft, link: quality?.link })} label="Copy pin" className="!rounded-lg !px-3 !py-1.5 !text-[13px] !font-semibold !text-white/80 !no-underline ring-1 ring-white/10 hover:!bg-white/[0.1]" />
        </div>
        {editing && (
          <div className="flex flex-col gap-3 rounded-xl bg-black/20 p-3 ring-1 ring-white/10">
            {main}
            {concept}
            {extra}
          </div>
        )}
        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-3">{tail}</div>
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-3.5 py-2.5">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/45">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
