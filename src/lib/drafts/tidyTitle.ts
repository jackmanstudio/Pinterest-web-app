import { seasonTiming } from "@/lib/seo/seasonality";

/**
 * Small, safe clean-ups for English pin titles from any provider: repeated
 * words or phrases, a second season tacked on, "Ideas Is", and capitalised
 * joining words in Title Case. tidyTitle never adds words; ensureSeoTitle
 * (used by tidyDrafts) adds the main keyword or length when a title lacks them.
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

const GENERIC = new Set(["ideas", "idea", "tips", "guide", "inspiration", "easy", "best", "simple", "ways", "budget"]);
const TRAIL = new Set(["ideas", "idea", "tips", "guide", "inspiration"]);
const keyWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !GENERIC.has(w));

/** Does the title carry the idea's main keyword? (At least half of its key words, or the one there is.) */
export function hasMainKeyword(title: string, idea: string): boolean {
  const keys = [...new Set(keyWords(idea))];
  if (!keys.length) return true;
  const t = title.toLowerCase();
  const hits = keys.filter((w) => t.includes(w.replace(/s$/, ""))).length;
  return hits >= (keys.length >= 3 ? Math.ceil(keys.length / 2) : 1);
}

/** The idea as a headline keyword: Title Case, without trailing filler like "ideas" or "tips", at most ~50 characters. */
export function mainKeyword(idea: string): string {
  let words = idea.trim().replace(/[.!?]+$/, "").split(/\s+/);
  while (words.length > 2 && TRAIL.has(words[words.length - 1].toLowerCase())) words = words.slice(0, -1);
  let out = "";
  for (const w of words) {
    if ((out + " " + w).trim().length > 50) break;
    out = `${out} ${w}`.trim();
  }
  out = out.replace(/\s+(for|on|with|in|and|to|of|a|the)$/i, "");
  return fixCase(out.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
}

export const MIN_TITLE = 40;

/**
 * Makes sure an English title works for Pinterest search: it leads with the
 * idea's main keyword when it lacks it, and short titles are lengthened.
 * Titles are never cut, and never longer than the 100-character limit.
 */
export function ensureSeoTitle(title: string, idea: string, max = 100): string {
  let t = title.trim();
  const [head, ...rest] = t.split(":");
  const hook = rest.join(":").trim();
  if (!hasMainKeyword(t, idea)) {
    const k = mainKeyword(idea);
    const candidate = `${k}: ${hook || head.trim()}`;
    if (k && candidate.length <= max) t = candidate;
  }
  if (t.length < MIN_TITLE && hook) {
    // Short "Head: hook" → lead with the full keyword instead of the short head.
    const k = mainKeyword(idea);
    if (k.length > head.trim().length && `${k}: ${hook}`.length <= max) t = `${k}: ${hook}`;
  }
  if (t.length < MIN_TITLE) {
    const extra = t.includes(":") ? " to Save and Try" : /\bideas?\b/i.test(t) ? ": Worth Saving and Trying" : ": Ideas Worth Saving";
    if ((t + extra).length <= max) t = t + extra;
  }
  return t;
}

/** ", Save this pin for later." → ". Save this pin for later." */
export function tidyDescription(desc: string): string {
  return desc.replace(/,\s+(Save|Pin|Tap|Click)\b/g, ". $1").replace(/,\s*$/, ".");
}

/**
 * A season the idea never mentions, out of season today ("Summer … refresh"
 * in November), is dropped from the title.
 */
export function dropOffSeason(title: string, idea: string, now = new Date()): string {
  let t = title;
  for (const s of SEASONS) {
    const status = seasonTiming(s, now).status;
    if (status === "ahead" || status === "peak" || status === "evergreen" || new RegExp(`\\b${s}\\b`, "i").test(idea)) continue;
    t = t.replace(new RegExp(`\\b${s}('s)?\\s+`, "i"), "").replace(new RegExp(`\\s+(for|this|in)\\s+${s}\\b`, "i"), "");
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Tidies English titles and descriptions in a set of drafts (other languages are left as written). */
export function tidyDrafts<T extends { title: string; description?: string }>(drafts: T[], idea: string, language?: string | null, now = new Date()): T[] {
  if (language && !/^english$/i.test(language.trim())) return drafts;
  return drafts.map((d) => ({
    ...d,
    title: ensureSeoTitle(tidyTitle(dropOffSeason(d.title, idea, now), idea), idea),
    ...(typeof d.description === "string" ? { description: tidyDescription(d.description) } : {}),
  }));
}
