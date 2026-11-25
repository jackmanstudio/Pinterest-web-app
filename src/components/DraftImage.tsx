"use client";
import { useEffect, useState } from "react";
import type { Store } from "@/lib/store";
import type { PinDraft, WorkspaceKind } from "@/lib/types";
import { SourceBadge } from "./DraftEditor";

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
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, draftId: draft.id, prompt: store.mode === "demo" ? draft.image_prompt : undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Image generation failed");
        // Server marks the draft failed in Supabase mode; reflect it.
        if (store.mode === "supabase") onUpdated(await store.getDraft(draft.workspace_id, draft.id));
        else onUpdated(await store.setImage(draft.workspace_id, draft.id, { image_status: "failed", image_path: draft.image_path, image_source: draft.image_source }));
        return;
      }
      const updated = await store.setImage(draft.workspace_id, draft.id, { image_status: "ready", image_path: body.image_path, image_source: body.source });
      onUpdated(updated);
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-2">
      {url ? (
        <div className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed/data URLs, not optimisable */}
          <img src={url} alt={draft.alt_text} className="aspect-[2/3] w-full rounded object-cover" />
          {draft.image_source && <SourceBadge source={draft.image_source} what="image" />}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">No image yet.</p>
      )}
      <button
        onClick={generate}
        disabled={busy || promptDirty}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
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
