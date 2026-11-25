import type { DraftContent } from "@/lib/types";

const STOP = new Set([
  "a", "an", "and", "the", "for", "to", "of", "in", "on", "with", "your", "you", "how", "is", "are", "this", "that", "it", "at", "by", "from", "or",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Two drafts are near-duplicates if their titles or descriptions overlap heavily. */
export const NEAR_DUPLICATE_THRESHOLD = 0.7;

export interface DuplicatePair {
  a: number;
  b: number;
  field: "title" | "description";
  score: number;
}

export function findNearDuplicates(drafts: DraftContent[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      for (const field of ["title", "description"] as const) {
        const score = jaccard(drafts[i][field], drafts[j][field]);
        if (score >= NEAR_DUPLICATE_THRESHOLD) pairs.push({ a: i, b: j, field, score });
      }
    }
  }
  return pairs;
}
