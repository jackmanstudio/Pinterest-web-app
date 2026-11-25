import type { Store } from "@/lib/store";
import type { PinDraft, WorkspaceKind } from "@/lib/types";
import type { DesignReport } from "@/lib/brand/check";

export interface ImageResult {
  draft: PinDraft;
  error: string | null;
  /** The design self-check for the new image (not stored; shown right after generation). */
  design?: DesignReport;
  /** E.g. the page photo couldn't be downloaded, so an AI image was made instead. */
  notice?: string | null;
}

/** Asks the server to make one draft's image and records the result in the store. */
export async function generateDraftImage(kind: WorkspaceKind, store: Store, draft: PinDraft, opts: { sourceImage?: string; sourcePage?: string } = {}): Promise<ImageResult> {
  let res: Response | null = null;
  let body: { error?: string; image_path?: string; source?: PinDraft["image_source"]; design?: DesignReport; notice?: string | null } = {};
  // Demo storage lives in the browser, so the server needs the prompt, title and pin design sent along.
  const brand = store.mode === "demo" ? await store.getBrand(draft.workspace_id) : null;
  const demo = brand ? { prompt: draft.image_prompt, title: draft.title, angle: draft.angle, template: brand.pin_template, imageStyle: brand.image_style || undefined } : {};
  // One automatic retry for network errors and server hiccups.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: kind, draftId: draft.id, ...demo, ...(opts.sourceImage ? { sourceImage: opts.sourceImage, sourcePage: opts.sourcePage } : {}) }),
      });
      body = await res.json().catch(() => ({}));
      if (res.ok || ![500, 502, 503, 504].includes(res.status)) break;
    } catch {
      res = null;
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!res) return { draft, error: "Could not reach the server. Check your connection and retry." };
  if (!res.ok) {
    // The server marks the draft failed in Supabase mode; mirror that in demo storage.
    const failed =
      store.mode === "supabase"
        ? await store.getDraft(draft.workspace_id, draft.id)
        : await store.setImage(draft.workspace_id, draft.id, { image_status: "failed", image_path: draft.image_path, image_source: draft.image_source });
    return { draft: failed, error: body.error ?? "Image generation failed" };
  }
  const updated = await store.setImage(draft.workspace_id, draft.id, { image_status: "ready", image_path: body.image_path ?? null, image_source: body.source ?? null });
  return { draft: updated, error: null, design: body.design, notice: body.notice ?? null };
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
