export interface BoardLike {
  board_id: string;
  name: string;
  description?: string | null;
}

export interface BoardPick {
  board: BoardLike;
  score: number;
  reason: string;
}

const STOP = new Set(["the", "and", "for", "with", "your", "ideas", "tips", "my", "our", "of", "to", "in", "on", "a", "an", "how"]);
const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
/** Words too broad to decide a board on their own ("Modest Fashion" isn't right for every fashion pin). */
const GENERIC = new Set(["fashion", "style", "styl", "inspiration", "guide", "best", "easy", "new", "simple", "cute", "beautiful", "aesthetic", "trend", "trending", "idea", "look", "macro", "general"].map(stem));
/** Below this a match is too weak to recommend. */
export const MIN_BOARD_SCORE = 3;
const words = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/**
 * Recommends one of the account's own boards for a pin (spec 24.4) by matching
 * the board's name/description with the pin's title, tags and category.
 * Returns null when nothing matches; the user always chooses in the end.
 */
export function recommendBoard(boards: BoardLike[], pin: { title: string; tags: string[]; category?: string | null }): BoardPick | null {
  const cat = new Set(words(pin.category ?? ""));
  const titleTags = new Set([...words(pin.title), ...pin.tags.flatMap(words)]);
  const pinWords = new Set([...titleTags, ...cat]);
  let best: BoardPick | null = null;
  for (const b of boards) {
    const nameWords = words(b.name);
    const descWords = words(b.description ?? "");
    let score = 0;
    const hits: string[] = [];
    for (const w of new Set(nameWords)) {
      if (!pinWords.has(w)) continue;
      // A broad word, or one that only comes from the category, is a weak signal.
      const fromPin = titleTags.has(w);
      score += GENERIC.has(w) ? 1 : fromPin ? (cat.has(w) ? 4 : 3) : 1;
      hits.push(w);
    }
    for (const w of new Set(descWords)) if (pinWords.has(w) && !nameWords.includes(w) && !GENERIC.has(w)) score += 1;
    if (score >= MIN_BOARD_SCORE && (!best || score > best.score)) {
      best = { board: b, score, reason: hits.length ? `board name matches “${hits.join("”, “")}”` : "board description matches the pin" };
    }
  }
  return best;
}
