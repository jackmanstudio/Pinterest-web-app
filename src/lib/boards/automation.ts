import { z } from "zod";
import { recommendBoard, type BoardLike } from "@/lib/publishing/boards";
import { isWorkspaceNiche, nicheFromSlug, type WorkspaceKind, type WorkspaceNiche } from "@/lib/types";

/**
 * Spec 11: board & category automation. Pure logic shared by the client,
 * the API route and tests. The AI does the content analysis; this module
 * applies the user's mode, validates whatever the AI returns against the
 * account's real boards, and falls back to keyword matching without AI.
 */

export const BOARD_MODES = ["auto", "manual", "rules", "custom"] as const;
export type BoardMode = (typeof BOARD_MODES)[number];
export const BOARD_MODE_LABELS: Record<BoardMode, { title: string; detail: string }> = {
  auto: { title: "Automatic", detail: "AI reads each pin and picks the best board. Recommended." },
  manual: { title: "Manual", detail: "Every pin goes to one board you choose." },
  rules: { title: "Keyword rules", detail: "Your rules first (e.g. “wedding” → Wedding Ideas); AI for the rest." },
  custom: { title: "Custom", detail: "AI suggests, and you pick the board for each pin yourself." },
};

export const MAX_BULK_KEYWORDS = 50;
export const MAX_RULES = 100;

export interface BoardRule {
  keyword: string;
  board_id: string;
  board_name: string;
}
export interface KeywordPlanRow {
  keyword: string;
  category: string;
  board_id: string | null;
  board_name: string | null;
}
export interface BoardSettings {
  mode: BoardMode;
  manual_board_id: string | null;
  manual_board_name: string | null;
  rules: BoardRule[];
  keyword_plan: KeywordPlanRow[];
  /** Categories the user picked for boards (board_id → category). Other boards use the detected one. */
  board_categories?: Record<string, string>;
}
export const DEFAULT_BOARD_SETTINGS: BoardSettings = { mode: "auto", manual_board_id: null, manual_board_name: null, rules: [], keyword_plan: [], board_categories: {} };
export const MAX_BOARD_CATEGORY = 80;
export const MAX_BOARD_CATEGORIES = 500;

export type PlanMethod = "ai" | "keyword" | "rule" | "manual" | "custom" | "plan";
export const METHOD_LABELS: Record<PlanMethod, string> = {
  ai: "AI pick",
  keyword: "Keyword match",
  rule: "Your rule",
  manual: "Manual board",
  custom: "You chose",
  plan: "Bulk plan",
};

/** The saved board choice for one pin. */
export interface BoardPlan {
  draft_id: string;
  board_id: string;
  board_name: string;
  category: string | null;
  reason: string | null;
  method: PlanMethod;
  confidence: number | null;
}

export interface Board extends BoardLike {
  privacy?: string | null;
  pin_count?: number | null;
}

/** A board's category: the one the user picked, else detected from its name and description. */
export interface BoardCategory {
  category: string;
  /** "custom" = picked by the user; "auto" = detected. */
  source: "auto" | "custom";
}

/** What we know about a pin (or a bulk keyword) when picking its board. */
export interface PinFacts {
  key: string;
  keyword: string;
  title?: string;
  description?: string;
  tags?: string[];
  /** Alt text describes the image, so it stands in for the image itself. */
  alt_text?: string;
}

export interface NewBoardSuggestion {
  name: string;
  description: string;
  keywords: string[];
}

/** One pin's result, before the user saves it. */
export interface Assignment {
  key: string;
  category: string;
  board_id: string | null;
  board_name: string | null;
  confidence: number;
  reason: string;
  method: PlanMethod;
  new_board: NewBoardSuggestion | null;
}

/** Content categories from the spec, plus common Pinterest niches. Keyword hints are only for the no-AI fallback. */
export const CONTENT_CATEGORIES: Record<string, string[]> = {
  Wedding: ["wedding", "bride", "bridal", "bridesmaid", "engagement", "groom", "nikah", "mehndi", "reception"],
  "Home Decor": ["decor", "living room", "bedroom", "interior", "sofa", "cozy", "home", "wall art", "shelf", "kitchen decor"],
  Printables: ["printable", "printables", "planner", "worksheet", "template", "checklist", "free download", "pdf"],
  Fashion: ["outfit", "outfits", "fashion", "dress", "style", "wear", "coat", "jeans", "shoes", "abaya", "hijab", "street style"],
  "Recipes & Food": ["recipe", "recipes", "dinner", "lunch", "breakfast", "cake", "dessert", "baking", "meal", "food", "cook"],
  "Business Tips": ["business", "marketing", "entrepreneur", "income", "blog", "seo", "sales", "brand", "startup", "side hustle"],
  Travel: ["travel", "travel tips", "trip", "destination", "beach", "itinerary", "vacation", "hotel", "packing"],
  Christmas: ["christmas", "christmas tree", "xmas", "holiday gift", "advent", "santa", "stocking"],
  "Holidays & Seasonal": ["halloween", "thanksgiving", "easter", "eid", "ramadan", "valentine", "autumn", "fall", "summer", "spring", "winter"],
  Beauty: ["makeup", "skincare", "nails", "hair", "hairstyle", "beauty", "lipstick", "perfume"],
  "DIY & Crafts": ["diy", "craft", "crafts", "handmade", "sewing", "knit", "upcycle"],
  "Health & Fitness": ["workout", "fitness", "exercise", "yoga", "weight loss", "healthy", "wellness", "sleep"],
  Parenting: ["baby", "kids", "toddler", "parenting", "mom", "nursery"],
  Gardening: ["garden", "gardening", "plants", "plant", "flowers", "succulent"],
  "Personal Finance": ["budget", "saving", "money", "debt", "finance", "invest"],
};

const norm = (s: string) => ` ${s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Fallback category detection (no AI): counts keyword hints in the pin's text. */
export function guessCategory(text: string): { category: string; score: number } {
  const t = norm(text);
  let best = { category: "General", score: 0 };
  for (const [category, hints] of Object.entries(CONTENT_CATEGORIES)) {
    let score = 0;
    for (const h of hints) if (t.includes(` ${h} `)) score += h.includes(" ") ? 3 : 2;
    if (score > best.score) best = { category, score };
  }
  return best;
}

/** Detects a board's category from its name and description ("General" when nothing fits). */
export function detectBoardCategory(board: Pick<BoardLike, "name" | "description">, categories: string[] = []): string {
  const text = [board.name, board.description].filter(Boolean).join(" ");
  // The account's own categories first: a board named like one of them is that category.
  const t = norm(text);
  let best: { name: string; score: number } | null = null;
  for (const c of categories) {
    const words = norm(c).trim().split(" ").filter((w) => w.length > 2 && !["and", "the", "for", "ideas", "tips"].includes(w));
    if (!words.length) continue;
    const hits = words.filter((w) => t.includes(` ${w} `) || t.includes(` ${w.replace(/s$/, "")} `)).length;
    const score = hits / words.length;
    if (hits && score >= 0.5 && (!best || score > best.score)) best = { name: c, score };
  }
  if (best) return best.name;
  return guessCategory(text).category;
}

/** Category for every board: the user's pick wins, otherwise auto-detected. */
export function boardCategories(boards: Pick<BoardLike, "board_id" | "name" | "description">[], picked: Record<string, string> = {}, categories: string[] = []): Record<string, BoardCategory> {
  const out: Record<string, BoardCategory> = {};
  for (const b of boards) {
    const own = picked[b.board_id]?.trim();
    out[b.board_id] = own ? { category: own, source: "custom" } : { category: detectBoardCategory(b, categories), source: "auto" };
  }
  return out;
}

/** Boards with their category attached, so pin matching and the AI can use it. */
export function withBoardCategories<B extends BoardLike>(boards: B[], picked: Record<string, string> = {}, categories: string[] = []): (B & { category: string })[] {
  const cats = boardCategories(boards, picked, categories);
  return boards.map((b) => ({ ...b, category: cats[b.board_id].category }));
}

/** Keeps only valid picks (trimmed, short, known boards when given). */
export function cleanBoardCategories(picked: Record<string, string> | undefined, boardIds?: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, c] of Object.entries(picked ?? {})) {
    const v = (c ?? "").trim().slice(0, MAX_BOARD_CATEGORY);
    if (!v || !id || id.length > 64 || (boardIds && !boardIds.has(id))) continue;
    out[id] = v;
    if (Object.keys(out).length >= MAX_BOARD_CATEGORIES) break;
  }
  return out;
}

export const factsText = (p: PinFacts) => [p.keyword, p.title, p.description, (p.tags ?? []).join(" "), p.alt_text].filter(Boolean).join(" ");

/** Case/spacing/punctuation-insensitive board name, used to block duplicates. */
export function boardNameKey(name: string) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}
export function findBoardByName(boards: Board[], name: string): Board | null {
  const k = boardNameKey(name);
  return k ? (boards.find((b) => boardNameKey(b.name) === k) ?? null) : null;
}

/** A tidy new-board suggestion for a category, unless a board with that name already exists. */
export function suggestBoard(category: string, keyword: string, boards: Board[]): NewBoardSuggestion | null {
  const base = category === "General" ? keyword : category;
  const name = base.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 50) + (/(ideas|inspiration|tips)$/i.test(base) ? "" : " Ideas");
  if (findBoardByName(boards, name) || findBoardByName(boards, base)) return null;
  const kw = Array.from(new Set([keyword.toLowerCase(), category.toLowerCase(), ...(CONTENT_CATEGORIES[category] ?? []).slice(0, 4)])).filter((k) => k && k !== "general").slice(0, 6);
  return {
    name,
    description: `${base} ideas, inspiration and tips: ${kw.slice(0, 4).join(", ")}. Save the pins you love and come back for more.`.slice(0, 480),
    keywords: kw,
  };
}

/** Matches a user rule: the rule keyword appears as a phrase in the pin. */
export function matchRule(rules: BoardRule[], p: PinFacts): BoardRule | null {
  const t = norm(factsText(p));
  return rules.find((r) => r.keyword.trim() && t.includes(norm(r.keyword))) ?? null;
}

/** No-AI fallback for one pin: keyword overlap with the account's boards. */
export function keywordAssign(p: PinFacts, boards: Board[]): Assignment {
  const { category, score } = guessCategory(factsText(p));
  const pick = recommendBoard(boards, { title: [p.keyword, p.title].filter(Boolean).join(" "), tags: p.tags ?? [], category: category === "General" ? null : category });
  const confidence = pick ? Math.min(90, 35 + pick.score * 10) : 0;
  return {
    key: p.key,
    category,
    board_id: pick?.board.board_id ?? null,
    board_name: pick?.board.name ?? null,
    confidence,
    reason: pick ? `${pick.reason[0].toUpperCase()}${pick.reason.slice(1)}.` : score > 0 ? `No board fits “${category}” yet.` : "No board clearly matches this pin.",
    method: "keyword",
    new_board: pick ? null : suggestBoard(category, p.keyword, boards),
  };
}

/** The AI's answer for one pin, validated by the server against the real board list. */
export const AiAssignmentSchema = z.object({
  key: z.string(),
  category: z.string().min(1).max(60),
  board_id: z.string().max(64).nullable(),
  confidence: z.number().min(0).max(100),
  reason: z.string().max(240),
  new_board: z.object({ name: z.string().min(1).max(50), description: z.string().max(500), keywords: z.array(z.string().max(40)).max(8) }).nullable(),
});
export const AiAssignmentSetSchema = z.object({ assignments: z.array(AiAssignmentSchema) });
export type AiAssignment = z.infer<typeof AiAssignmentSchema>;

/** Below this the AI's pick is treated as "unrelated" and not auto-assigned. */
export const MIN_CONFIDENCE = 45;

/**
 * Accepts an AI answer only if the board really is one of the account's
 * boards and the AI is confident; never trusts a new-board name that
 * duplicates an existing board (that board is used instead).
 */
export function acceptAiAssignment(ai: AiAssignment, p: PinFacts, boards: Board[]): Assignment {
  const board = ai.board_id ? boards.find((b) => b.board_id === ai.board_id) : undefined;
  let newBoard = ai.new_board ? { ...ai.new_board, name: ai.new_board.name.trim() } : null;
  let chosen: Board | null = board && ai.confidence >= MIN_CONFIDENCE ? board : null;
  let reason = ai.reason;
  if (newBoard) {
    const dup = findBoardByName(boards, newBoard.name);
    if (dup) {
      newBoard = null;
      if (!chosen) {
        chosen = dup;
        reason = `${reason} (A board named “${dup.name}” already exists, so it is used instead of making a duplicate.)`;
      }
    }
  }
  if (!chosen && !board && ai.board_id) reason = `${reason} (The suggested board isn't on this account, so it was ignored.)`;
  if (!chosen && board) reason = `${reason} (Low confidence, so it wasn't auto-assigned.)`;
  return {
    key: p.key,
    category: ai.category,
    board_id: chosen?.board_id ?? null,
    board_name: chosen?.name ?? null,
    confidence: Math.round(ai.confidence),
    reason,
    method: "ai",
    new_board: chosen ? null : (newBoard ?? suggestBoard(ai.category, p.keyword, boards)),
  };
}

/** Mode rules applied before any AI call. Returns the pins that still need AI (or the keyword fallback). */
export function presetAssignments(pins: PinFacts[], settings: BoardSettings, boards: Board[]): { done: Assignment[]; rest: PinFacts[] } {
  const done: Assignment[] = [];
  const rest: PinFacts[] = [];
  const has = (id: string | null) => Boolean(id && boards.some((b) => b.board_id === id));
  for (const p of pins) {
    const category = guessCategory(factsText(p)).category;
    if (settings.mode === "manual" && has(settings.manual_board_id)) {
      const b = boards.find((x) => x.board_id === settings.manual_board_id)!;
      done.push({ key: p.key, category, board_id: b.board_id, board_name: b.name, confidence: 100, reason: "Manual mode: every pin goes to this board.", method: "manual", new_board: null });
      continue;
    }
    const planned = settings.keyword_plan.find((k) => k.board_id && has(k.board_id) && norm(k.keyword) === norm(p.keyword));
    if (planned) {
      done.push({ key: p.key, category: planned.category, board_id: planned.board_id, board_name: boards.find((b) => b.board_id === planned.board_id)!.name, confidence: 100, reason: `From your bulk plan for “${planned.keyword}”.`, method: "plan", new_board: null });
      continue;
    }
    const rule = settings.mode === "rules" ? matchRule(settings.rules.filter((r) => has(r.board_id)), p) : null;
    if (rule) {
      done.push({ key: p.key, category, board_id: rule.board_id, board_name: boards.find((b) => b.board_id === rule.board_id)!.name, confidence: 100, reason: `Your rule: “${rule.keyword}” → ${rule.board_name}.`, method: "rule", new_board: null });
      continue;
    }
    rest.push(p);
  }
  return { done, rest };
}

export interface BoardCheck {
  id: "chosen" | "valid" | "owned" | "available" | "related";
  ok: boolean;
  label: string;
}

/**
 * Pre-schedule checks (spec 11): a board is chosen, it exists, it belongs to
 * the connected account (it came from that account's sync), it's available
 * (seen in the latest sync), and it's related to the pin.
 */
export function boardChecks(
  boardId: string | null,
  boards: Board[],
  ctx: { connectedUsername: string | null; demo: boolean; facts: PinFacts; plan?: Pick<BoardPlan, "board_id" | "method" | "confidence"> | null },
): BoardCheck[] {
  const board = boardId ? boards.find((b) => b.board_id === boardId) : undefined;
  const out: BoardCheck[] = [{ id: "chosen", ok: Boolean(boardId), label: boardId ? "A board is chosen" : "Choose a board" }];
  if (!boardId) return out;
  out.push({ id: "valid", ok: Boolean(board), label: board ? `“${board.name}” is a valid board` : "This board wasn't found. Sync boards and choose again." });
  if (!board) return out;
  out.push({
    id: "owned",
    ok: !ctx.demo && Boolean(ctx.connectedUsername),
    label: ctx.demo ? "Demo sample board: connect Pinterest to use your real boards" : ctx.connectedUsername ? `Belongs to @${ctx.connectedUsername}` : "Connect Pinterest so we can confirm the board is yours",
  });
  out.push({ id: "available", ok: true, label: board.privacy === "SECRET" ? "Available (secret board: only you see these pins)" : "Available for new pins" });
  const userChose = ctx.plan && ctx.plan.board_id === boardId && ["custom", "manual", "rule", "plan"].includes(ctx.plan.method);
  const related = userChose || (ctx.plan?.board_id === boardId && (ctx.plan.confidence ?? 0) >= MIN_CONFIDENCE) || keywordAssign(ctx.facts, [board]).board_id === boardId;
  out.push({
    id: "related",
    ok: Boolean(related),
    label: related ? (userChose ? "Related: you chose this board" : "Related to the pin") : "This board doesn't look related to the pin. Double-check it.",
  });
  return out;
}

export function groupByBoard<T extends { board_id: string | null; board_name: string | null }>(rows: T[]): { board_id: string | null; board_name: string; rows: T[] }[] {
  const map = new Map<string, { board_id: string | null; board_name: string; rows: T[] }>();
  for (const r of rows) {
    const k = r.board_id ?? "";
    if (!map.has(k)) map.set(k, { board_id: r.board_id, board_name: r.board_name ?? "No board yet", rows: [] });
    map.get(k)!.rows.push(r);
  }
  return [...map.values()].sort((a, b) => (a.board_id ? 0 : 1) - (b.board_id ? 0 : 1) || b.rows.length - a.rows.length);
}

/** Bulk mode input: one keyword per line (or comma-separated), de-duplicated, max 50. */
export function parseKeywords(text: string): { keywords: string[]; dropped: number } {
  const all = text.split(/[\n,]+/).map((s) => s.trim().replace(/\s+/g, " ").slice(0, 100)).filter(Boolean);
  const seen = new Set<string>();
  const uniq = all.filter((k) => {
    const n = k.toLowerCase();
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  return { keywords: uniq.slice(0, MAX_BULK_KEYWORDS), dropped: Math.max(0, uniq.length - MAX_BULK_KEYWORDS) };
}

/** Sample boards for demo mode, clearly labelled in the UI. */
export const SAMPLE_BOARDS: Record<WorkspaceNiche, Board[]> = {
  fashion: [
    { board_id: "demo-fa-1", name: "Everyday Outfit Ideas", description: "Casual outfits, street style and capsule wardrobe looks" },
    { board_id: "demo-fa-2", name: "Modest Fashion & Abayas", description: "Hijab styles, abayas, modest eid outfits" },
    { board_id: "demo-fa-3", name: "Wedding Guest Dresses", description: "What to wear to a wedding, bridal and mehndi outfits" },
    { board_id: "demo-fa-4", name: "Shoes & Bags", description: "Sneakers, heels, handbags and accessories" },
    { board_id: "demo-fa-5", name: "Jewelry & Watches", description: "Necklaces, rings, earrings and watches" },
    { board_id: "demo-fa-6", name: "Winter & Autumn Style", description: "Coats, trench coats, sweaters and layering" },
  ],
  macro: [
    { board_id: "demo-ma-1", name: "Home Decor Ideas", description: "Living room, bedroom and cozy home decor" },
    { board_id: "demo-ma-2", name: "Easy Recipes", description: "Quick dinner, breakfast and dessert recipes" },
    { board_id: "demo-ma-3", name: "Wedding Planning", description: "Wedding decor, bridal ideas and checklists" },
    { board_id: "demo-ma-4", name: "Free Printables", description: "Printable planners, checklists and templates" },
    { board_id: "demo-ma-5", name: "Business & Blogging Tips", description: "Online business, marketing, SEO and side hustle tips" },
    { board_id: "demo-ma-6", name: "Travel Destinations", description: "Travel itineraries, beaches and packing lists" },
    { board_id: "demo-ma-7", name: "Christmas Ideas", description: "Christmas decor, gifts and holiday recipes" },
  ],
};

/** Demo boards for an account (by niche, or a guess from its slug). */
export function sampleBoardsFor(kindOrNiche: WorkspaceKind | WorkspaceNiche): Board[] {
  return SAMPLE_BOARDS[isWorkspaceNiche(kindOrNiche) ? kindOrNiche : nicheFromSlug(kindOrNiche)];
}
