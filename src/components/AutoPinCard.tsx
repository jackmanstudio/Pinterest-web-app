"use client";
import { useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import type { PinDraft } from "@/lib/types";
import { SourceBadge } from "./DraftEditor";
import { CopyButton, pinAsText } from "./CopyButton";
import { downloadImage } from "@/lib/client/download";
import type { DesignReport } from "@/lib/brand/check";

interface Props {
  store: Store;
  draft: PinDraft;
  error?: string;
  disabled: boolean;
  /** Design self-check for the image just made. */
  design?: DesignReport;
  onRetry: () => void;
}

/** Read-only preview of a finished pin from the one-step flow. */
export function AutoPinCard({ store, draft, error, disabled, onRetry, design }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (draft.image_status === "ready") store.imageUrl(draft).then((u) => !cancelled && setUrl(u)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [store, draft]);

  const shown = draft.image_status === "ready" ? url : null;
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="relative aspect-[2/3] bg-zinc-100">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed/data URLs, not optimisable
          <img src={shown} alt={draft.alt_text} className="h-full w-full object-cover" />
        ) : error || draft.image_status === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-red-700">
            <span role="alert">{error ?? "Image failed"}</span>
            <button onClick={onRetry} disabled={disabled} className="rounded border border-red-300 px-2 py-1 font-medium disabled:opacity-50">
              Retry image
            </button>
          </div>
        ) : (
          <div className="flex h-full animate-pulse items-center justify-center text-xs text-zinc-500">Making image…</div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{draft.angle}</p>
        <h3 className="text-sm font-semibold leading-snug">{draft.title}</h3>
        <p className="line-clamp-3 text-xs text-zinc-600">{draft.description}</p>
        <p className="line-clamp-2 text-xs text-zinc-500">{draft.tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" ")}</p>
        <div className="flex flex-wrap gap-1">
          <SourceBadge source={draft.source} />
          {draft.image_source && draft.image_status === "ready" && <SourceBadge source={draft.image_source} what="image" />}
        </div>
        {design && draft.image_source !== "demo" && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-600">
              Design check: <span className={design.score >= 85 ? "font-semibold text-emerald-700" : design.score >= 65 ? "font-semibold text-zinc-800" : "font-semibold text-amber-700"}>{design.score}/100</span> · {design.layout}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {design.checks.map((c) => (
                <li key={c.id}>
                  {c.status === "pass" ? "✓" : c.status === "manual" ? "👀" : c.status === "warn" ? "!" : "✗"} {c.question} <span className="text-zinc-500">{c.detail}</span>
                </li>
              ))}
            </ul>
            {design.score < 65 && (
              <button onClick={onRetry} disabled={disabled} className="mt-1 underline disabled:opacity-50">Make a new image</button>
            )}
          </details>
        )}
        {design && draft.image_source === "demo" && <p className="text-xs text-zinc-500">Layout: {design.layout} (design check runs on real AI images)</p>}
        <div className="mt-1 flex flex-wrap gap-3 border-t border-zinc-100 pt-2">
          <CopyButton text={pinAsText(draft)} label="Copy text" />
          {shown && (
            <button type="button" onClick={() => downloadImage(shown, draft.title).catch(() => {})} className="text-xs text-zinc-500 underline decoration-zinc-300 hover:text-zinc-900">
              Download image
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
