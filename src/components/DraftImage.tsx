"use client";
import { useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import type { PinDraft, WorkspaceKind } from "@/lib/types";
import { SourceBadge } from "./DraftEditor";
import { generateDraftImage } from "@/lib/client/pinImages";

interface Props {
  kind: WorkspaceKind;
  store: Store;
  draft: PinDraft;
  /** True when the image prompt has unsaved edits. */
  promptDirty: boolean;
  onUpdated: (d: PinDraft) => void;
}

export function DraftImage({ kind, store, draft, promptDirty, onUpdated }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .imageUrl(draft)
      .then((u) => !cancelled && setUrl(u))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [store, draft]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await generateDraftImage(kind, store, draft);
      setError(r.error);
      onUpdated(r.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] ring-1 ring-white/10">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed/data URLs, not optimisable
          <img src={url} alt={draft.alt_text} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/50">No image yet</p>
        )}
      </div>
      {url && draft.image_source && <SourceBadge source={draft.image_source} what="image" />}
      <button
        onClick={generate}
        disabled={busy || promptDirty}
        className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
        title={promptDirty ? "Save your edits first so the image uses the latest prompt" : undefined}
      >
        {busy ? "Generating image…" : url ? "Regenerate image" : "Generate image"}
      </button>
      {promptDirty && <p className="text-xs text-zinc-500">Save changes first to use the edited prompt.</p>}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
