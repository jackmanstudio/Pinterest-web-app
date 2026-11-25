"use client";
import { useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import type { PinDraft } from "@/lib/types";
import { SourceBadge } from "./DraftEditor";
import { CopyButton, pinAsText } from "./CopyButton";
import { downloadImage } from "@/lib/client/download";

interface Props {
  store: Store;
  draft: PinDraft;
  error?: string;
  disabled: boolean;
  onRetry: () => void;
}

/** Read-only preview of a finished pin from the one-step flow. */
export function AutoPinCard({ store, draft, error, disabled, onRetry }: Props) {
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
