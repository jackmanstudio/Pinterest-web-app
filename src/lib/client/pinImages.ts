import type { Store } from "@/lib/store";
import type { PinDraft, WorkspaceKind } from "@/lib/types";

export interface ImageResult {
  draft: PinDraft;
  error: string | null;
}

/** Asks the server to make one draft's image and records the result in the store. */
export async function generateDraftImage(kind: WorkspaceKind, store: Store, draft: PinDraft): Promise<ImageResult> {
  let res: Response;
  try {
    res = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: kind, draftId: draft.id, prompt: store.mode === "demo" ? draft.image_prompt : undefined }),
    });
  } catch {
    return { draft, error: "Could not reach the server. Check your connection and retry." };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server marks the draft failed in Supabase mode; mirror that in demo storage.
    const failed =
      store.mode === "supabase"
        ? await store.getDraft(draft.workspace_id, draft.id)
        : await store.setImage(draft.workspace_id, draft.id, { image_status: "failed", image_path: draft.image_path, image_source: draft.image_source });
    return { draft: failed, error: body.error ?? "Image generation failed" };
  }
  const updated = await store.setImage(draft.workspace_id, draft.id, { image_status: "ready", image_path: body.image_path, image_source: body.source });
  return { draft: updated, error: null };
}

/** Runs tasks with at most `limit` in flight, reporting each result as it lands. */
export async function runPool<T, R>(items: T[], limit: number, task: (item: T, i: number) => Promise<R>, onResult?: (r: R, i: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
      onResult?.(out[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
