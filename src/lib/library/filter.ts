import { jaccard } from "@/lib/drafts/distinctness";
import type { DraftStatus, PinDraft } from "@/lib/types";

export interface LibraryFilter {
  q: string;
  status: DraftStatus | "" | "archived";
  categoryId: string;
  from: string;
  to: string;
  showArchived: boolean;
}

export const EMPTY_FILTER: LibraryFilter = { q: "", status: "", categoryId: "", from: "", to: "", showArchived: false };

/** Search titles, descriptions, tags and the idea; filter by status, category (incl. sub-categories) and date. */
export function filterDrafts(drafts: PinDraft[], f: LibraryFilter, childIds: (id: string) => string[] = () => []): PinDraft[] {
  const q = f.q.trim().toLowerCase();
  const cats = f.categoryId ? new Set([f.categoryId, ...childIds(f.categoryId)]) : null;
  const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : null;
  const to = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : null;
  return drafts.filter((d) => {
    const archived = Boolean(d.archived_at);
    if (f.status === "archived") {
      if (!archived) return false;
    } else {
      if (archived && !f.showArchived) return false;
      if (f.status && d.status !== f.status) return false;
    }
    if (cats && !(d.category_id && cats.has(d.category_id))) return false;
    const t = new Date(d.created_at).getTime();
    if (from !== null && t < from) return false;
    if (to !== null && t > to) return false;
    if (q) {
      const hay = `${d.title}\n${d.description}\n${d.tags.join(" ")}\n${d.idea}\n${d.concept}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/**
 * Near-duplicates across the whole library (spec 12): pins from different
 * batches whose titles overlap heavily. Returns draft id → ids it resembles.
 */
export function libraryDuplicates(drafts: PinDraft[], threshold = 0.7): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const live = drafts.filter((d) => !d.archived_at);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.batch_id === b.batch_id && !a.duplicate_of && !b.duplicate_of) continue;
      if (a.duplicate_of === b.id || b.duplicate_of === a.id) continue; // intentional copies
      if (jaccard(a.title, b.title) >= threshold) {
        out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
        out.set(b.id, [...(out.get(b.id) ?? []), a.id]);
      }
    }
  }
  return out;
}
