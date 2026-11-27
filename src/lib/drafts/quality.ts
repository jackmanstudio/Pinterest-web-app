import type { DraftContent } from "@/lib/types";
import { LIMITS } from "./validation";
import { seasonTiming } from "@/lib/seo/seasonality";
import { GENERIC_PHRASES, splitIdea } from "@/lib/seo/keywords";

export type Severity = "ok" | "info" | "warning" | "error";

export interface QualityCheck {
  id: string;
  area: "SEO" | "Timing" | "Proofreading" | "Accessibility" | "Brand safety" | "Destination";
  severity: Severity;
  message: string;
}

export interface QualityReport {
  /** 0-100. A guide for edits, not a prediction of reach or ranking. */
  score: number;
  checks: QualityCheck[];
}

export interface QualityContext {
  bannedWords?: string[];
  focusKeywords?: string[];
  link?: string | null;
  /** Whether this pin must have a destination link. */
  requireLink?: boolean;
  /** The idea the pin was made from: the title should carry its main keyword. */
  idea?: string;
  /** Today's date: turns on the seasonal timing check. */
  today?: Date;
  /** Rising searches from the user's own Pinterest Trends snapshot (live data only). */
  trendKeywords?: string[];
}

const CLICHES = [
  "elevate your style", "must-have", "must have", "game-changer", "game changer", "look no further", "next level",
  "effortlessly chic", "you won't believe", "you wont believe", "unleash", "in today's world", "ultimate guide to everything",
];
const RISKY_CLAIMS = [
  "guaranteed", "guarantee", "100%", "cure", "cures", "miracle", "instantly lose", "risk-free", "risk free", "get rich", "overnight results", "doctor recommended", "clinically proven",
];
const VAGUE_TITLES = /^(tips|ideas|inspiration|things|stuff|post|pin|untitled|new pin)$/i;
const STOP = new Set(["the", "and", "for", "with", "your", "you", "this", "that", "are", "from", "into", "how", "what", "will", "can", "all", "our", "its", "it's", "a", "an", "to", "of", "in", "on", "is", "at", "by", "or"]);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
const contentWords = (s: string) => words(s).filter((w) => w.length > 2 && !STOP.has(w));
const has = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text.toLowerCase());

const PENALTY: Record<Severity, number> = { ok: 0, info: 2, warning: 8, error: 20 };

/**
 * Explainable, rule-based review of one pin's copy (spec sections 9, 11 and 24.3).
 * Every point lost is tied to a message the user can act on. It checks text only:
 * it cannot see the image, so image/copy consistency still needs a human look.
 */
export function reviewDraft(d: DraftContent, ctx: QualityContext = {}): QualityReport {
  const checks: QualityCheck[] = [];
  const add = (area: QualityCheck["area"], severity: Severity, id: string, message: string) => checks.push({ id, area, severity, message });
  const title = d.title.trim();
  const desc = d.description.trim();
  const all = `${title} ${desc} ${d.tags.join(" ")} ${d.alt_text}`;

  // SEO: title
  if (!title) add("SEO", "error", "title-missing", "Add a title.");
  else if (title.length > LIMITS.title) add("SEO", "error", "title-long", `Title is ${title.length} characters; Pinterest allows ${LIMITS.title}.`);
  else if (title.length < 25) add("SEO", "warning", "title-short", "Title is very short; add the main keyword and a clear promise (aim for 40-80 characters).");
  else if (title.length > 80) add("SEO", "info", "title-trim", "Title may be cut off on mobile; the first 40 characters matter most.");
  else if (title.length < 40 && /^[\p{Script=Latin}\d\s\p{P}\p{S}]+$/u.test(title)) add("SEO", "info", "title-shortish", "Title is under 40 characters; there is room for the main keyword and a clearer promise.");
  const ideaKeys = contentWords(ctx.idea ?? "").filter((w) => w.length > 3 && !["ideas", "tips", "guide", "budget", "easy", "best"].includes(w));
  if (title && ideaKeys.length && /^[\p{Script=Latin}\d\s\p{P}\p{S}]+$/u.test(title)) {
    const tl = title.toLowerCase();
    const hits = ideaKeys.filter((w) => tl.includes(w.replace(/s$/, ""))).length;
    if (hits < (ideaKeys.length >= 3 ? Math.ceil(ideaKeys.length / 2) : 1)) add("SEO", "warning", "title-keyword", `Title doesn't use the main keyword from your idea (“${ideaKeys.slice(0, 3).join(" ")}”); people search with those words.`);
  }
  if (title && VAGUE_TITLES.test(title)) add("SEO", "warning", "title-vague", "Title is too vague to match a search; say what the pin is about.");
  // The main keyword should sit in the first 40 characters: that is what shows in search and on phones.
  const primary = ctx.idea ? splitIdea(ctx.idea).head : "";
  const latin = /^[\p{Script=Latin}\d\s\p{P}\p{S}]+$/u.test(title);
  if (title && primary && latin && title.toLowerCase().includes(primary) && title.toLowerCase().indexOf(primary) + primary.length > 40)
    add("SEO", "info", "title-front", `Move “${primary}” to the start of the title; the first 40 characters matter most in search.`);
  const generic = GENERIC_PHRASES.filter((g) => has(`${title} ${desc}`, g));
  if (generic.length) add("SEO", "warning", "generic", `Generic wording: “${generic.slice(0, 3).join("”, “")}”. Name what this pin actually shows (item, colour, room, dish, result).`);

  // SEO: description
  if (!desc) add("SEO", "error", "desc-missing", "Add a description.");
  else if (desc.length > LIMITS.description) add("SEO", "error", "desc-long", `Description is ${desc.length} characters; the limit is ${LIMITS.description}.`);
  else if (desc.length < 100) add("SEO", "warning", "desc-short", "Description is thin; 150-300 characters with natural keywords works better.");
  const titleKeys = contentWords(title);
  if (title && desc && titleKeys.length && !titleKeys.some((w) => desc.toLowerCase().includes(w)))
    add("SEO", "warning", "mismatch", "Description doesn't mention any keyword from the title; make sure they describe the same thing.");
  const counts = new Map<string, number>();
  for (const w of contentWords(desc)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const stuffed = [...counts].filter(([, n]) => n >= 4).map(([w]) => w);
  if (stuffed.length) add("SEO", "warning", "stuffing", `Possible keyword stuffing: “${stuffed.join("”, “")}” repeats 4+ times.`);
  if (/#\w/.test(desc)) add("SEO", "info", "hashtags", "Hashtags in the description aren't needed; use tags instead.");

  // SEO: tags
  if (d.tags.length < 3) add("SEO", "warning", "tags-few", "Add at least 3 relevant tags.");
  if (d.tags.length > LIMITS.tags) add("SEO", "error", "tags-many", `Use at most ${LIMITS.tags} tags.`);
  const tagSet = new Set(d.tags.map((t) => t.toLowerCase().trim()));
  if (tagSet.size < d.tags.length) add("SEO", "info", "tags-dupe", "Some tags are repeated.");
  const textWords = new Set(contentWords(`${title} ${desc}`));
  const unrelated = d.tags.filter((t) => !contentWords(t).some((w) => textWords.has(w)));
  if (d.tags.length >= 3 && unrelated.length > d.tags.length / 2)
    add("SEO", "info", "tags-unrelated", `These tags don't appear in the title or description: ${unrelated.slice(0, 4).join(", ")}. Check they fit.`);
  const focus = (ctx.focusKeywords ?? []).filter(Boolean);
  if (focus.length && !focus.some((k) => has(all, k))) add("SEO", "info", "focus", "None of your brand focus keywords is used; add one if it fits naturally.");

  // Proofreading
  const doubled = /\b(\w+)\s+\1\b/i.exec(`${title} ${desc}`);
  if (doubled) add("Proofreading", "warning", "double-word", `Repeated word: “${doubled[1]} ${doubled[1]}”.`);
  if (/ {2,}/.test(`${title} ${desc}`)) add("Proofreading", "info", "spaces", "Extra spaces found.");
  if (/[!?]{2,}/.test(`${title} ${desc}`)) add("Proofreading", "warning", "punct", "Avoid repeated punctuation like “!!” or “?!”.");
  const caps = title.split(/\s+/).filter((w) => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (caps.length >= 2) add("Proofreading", "warning", "shouting", "Title uses several ALL-CAPS words; it reads as shouting.");
  if (desc && !/[.!?…)]$/.test(desc)) add("Proofreading", "info", "ending", "Description doesn't end with punctuation.");
  if (title && /^[a-z]/.test(title)) add("Proofreading", "info", "capital", "Start the title with a capital letter.");
  const cliches = CLICHES.filter((c) => has(all, c));
  if (cliches.length) add("Proofreading", "warning", "cliche", `Generic phrasing: “${cliches.join("”, “")}”. Say something specific instead.`);

  // Accessibility
  const alt = d.alt_text.trim();
  if (!alt) add("Accessibility", "error", "alt-missing", "Add alt text describing the image.");
  else {
    if (alt.length < 30) add("Accessibility", "warning", "alt-short", "Alt text is very short; describe what the image actually shows.");
    if (/^(image|picture|photo) of/i.test(alt)) add("Accessibility", "info", "alt-prefix", "Alt text doesn't need to start with “image of”.");
    if (alt.toLowerCase() === title.toLowerCase()) add("Accessibility", "warning", "alt-title", "Alt text just repeats the title; describe the visual instead.");
  }

  // Brand safety
  const banned = (ctx.bannedWords ?? []).filter((w) => w && has(all, w));
  if (banned.length) add("Brand safety", "error", "banned", `Uses banned word(s): ${banned.join(", ")}.`);
  const risky = RISKY_CLAIMS.filter((c) => has(all, c));
  if (risky.length) add("Brand safety", "warning", "claims", `Possible unsupported claim: “${risky.join("”, “")}”. Remove it unless you can back it up.`);

  // Destination
  if (ctx.link === undefined) {
    // not known here
  } else if (!ctx.link) {
    add("Destination", ctx.requireLink ? "error" : "info", "link-missing", "No destination link; pins with a link can send clicks to your site.");
  } else if (!/^https:\/\//i.test(ctx.link)) {
    add("Destination", "warning", "link-http", "Link is not HTTPS.");
  }

  // Timing: seasonal topics posted too late or far too early reach fewer planners.
  if (ctx.today) {
    const t = seasonTiming(`${title} ${desc} ${d.tags.join(" ")}`, ctx.today);
    if (t.status === "late") add("Timing", "warning", "season-late", t.message);
    else if (t.status === "peak" || t.status === "off") add("Timing", "info", `season-${t.status}`, t.message);
  }

  const score = Math.max(0, 100 - checks.reduce((s, c) => s + PENALTY[c.severity], 0));
  if (!checks.length) add("SEO", "ok", "all-good", "No issues found by the automatic checks.");
  if (ctx.today) {
    const t = seasonTiming(`${title} ${desc} ${d.tags.join(" ")}`, ctx.today);
    if (t.status === "ahead") add("Timing", "ok", "season-ahead", t.message);
  }
  const trending = (ctx.trendKeywords ?? []).filter((k) => k && has(all, k));
  if (trending.length) add("SEO", "ok", "trending", `Uses a rising Pinterest search from your Trends data: “${trending.slice(0, 3).join("”, “")}”.`);
  return { score, checks };
}

export function scoreLabel(score: number): string {
  if (score >= 85) return "Strong";
  if (score >= 65) return "Good, can improve";
  if (score >= 40) return "Needs work";
  return "Fix before publishing";
}
