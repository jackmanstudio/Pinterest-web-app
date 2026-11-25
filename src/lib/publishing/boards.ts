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
const words = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/**
 * Recommends one of the account's own boards for a pin (spec 24.4) by matching
 * the board's name/description with the pin's title, tags and category.
 * Returns null when nothing matches; the user always chooses in the end.
 */
export function recommendBoard(boards: BoardLike[], pin: { title: string; tags: string[]; category?: string | null }): BoardPick | null {
  const cat = new Set(words(pin.category ?? ""));
  const pinWords = new Set([...words(pin.title), ...pin.tags.flatMap(words), ...cat]);
  let best: BoardPick | null = null;
  for (const b of boards) {
    const nameWords = words(b.name);
    const descWords = words(b.description ?? "");
    let score = 0;
    const hits: string[] = [];
    for (const w of new Set(nameWords)) {
      if (pinWords.has(w)) {
        score += cat.has(w) ? 4 : 3;
        hits.push(w);
      }
    }
    for (const w of new Set(descWords)) if (pinWords.has(w) && !nameWords.includes(w)) score += 1;
    if (score > 0 && (!best || score > best.score)) {
      best = { board: b, score, reason: hits.length ? `board name matches “${hits.join("”, “")}”` : "board description matches the pin" };
    }
  }
  return best;
}
