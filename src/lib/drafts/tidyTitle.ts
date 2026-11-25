/**
 * Small, safe clean-ups for English pin titles from any provider: repeated
 * words or phrases, a second season tacked on, "Ideas Is", and capitalised
 * joining words in Title Case. It never adds new words.
 */
const SEASONS = ["spring", "summer", "autumn", "fall", "winter"];
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with", "vs", "from", "into", "nor"]);
const NOT_PLURAL = new Set(["this", "his", "its", "is", "was", "yes", "us", "plus", "bus", "gas", "bias", "chaos", "canvas", "kudos", "always", "perhaps", "whereas"]);

function fixCase(title: string): string {
  const words = title.split(" ");
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (words.length < 3 || caps / words.length < 0.6) return title; // not Title Case: leave it
  return words
    .map((w, i) => {
      const prev = words[i - 1] ?? "";
      const startsClause = i === 0 || /[:?!.–—-]$/.test(prev);
      return !startsClause && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w;
    })
    .join(" ");
}

export function tidyTitle(raw: string, idea = ""): string {
  let t = raw.replace(/\s+/g, " ").trim();
  // "Ideas Ideas" → "Ideas"
  t = t.replace(/\b([\p{L}\p{N}']+)(\s+\1\b)+/giu, "$1");
  // "for Autumn for Autumn", "Trench Coat Trench Coat" (2-3 word repeats)
  t = t.replace(/\b((?:[\p{L}\p{N}']+\s+){1,2}[\p{L}\p{N}']+)\s+\1\b/giu, "$1");
  // A repeated "for <season>" anywhere: keep the first.
  for (const s of SEASONS) {
    const re = new RegExp(`\\s+(?:for|this|in)\\s+${s}\\b`, "gi");
    const hits = t.match(re);
    if (hits && hits.length > 1) {
      let seen = false;
      t = t.replace(re, (m) => (seen ? "" : ((seen = true), m)));
    }
  }
  // A different season added on top of the idea's own season: drop the added phrase.
  const ideaSeason = SEASONS.find((s) => new RegExp(`\\b${s}\\b`, "i").test(idea));
  if (ideaSeason) {
    for (const s of SEASONS) {
      if (s === ideaSeason || (["autumn", "fall"].includes(s) && ["autumn", "fall"].includes(ideaSeason))) continue;
      const re = new RegExp(`\\s+(?:for|this|in)\\s+${s}\\b`, "i");
      if (re.test(t) && new RegExp(`\\b${ideaSeason}\\b`, "i").test(t)) t = t.replace(re, "");
    }
  }
  // "Outfit Ideas Is the Easy Fix" → "Outfit Ideas Are the Easy Fix"
  t = t.replace(/\b([\p{L}']+s)\s+(Is|is)\s+(the|a|an|your|my|our)\b/gu, (m, w: string, is: string, art: string) =>
    NOT_PLURAL.has(w.toLowerCase()) || /ss$/i.test(w) ? m : `${w} ${is === "Is" ? "Are" : "are"} ${art}`,
  );
  return fixCase(t.replace(/\s+([:?!,])/g, "$1").trim());
}

/** Tidies English titles in a set of drafts (other languages are left as written). */
export function tidyDrafts<T extends { title: string }>(drafts: T[], idea: string, language?: string | null): T[] {
  if (language && !/^english$/i.test(language.trim())) return drafts;
  return drafts.map((d) => ({ ...d, title: tidyTitle(d.title, idea) }));
}
