import type { DraftContent } from "@/lib/types";
import { LIMITS } from "./validation";
import { reviewDraft, type QualityCheck, type QualityContext } from "./quality";
import { ensureSeoTitle, mainKeyword, specificTail, tidyTitle } from "./tidyTitle";
import { GENERIC_PHRASES, splitIdea } from "@/lib/seo/keywords";

/**
 * One-click fixes for the Pin score checks. Rule-based and predictable:
 * it only changes what a check flagged, never invents claims, and leaves
 * anything that needs a human (images, timing, generic phrasing) as a note.
 */
export interface FixContext extends QualityContext {
  /** The brand's website, used when the pin has no destination link. */
  website?: string | null;
}

export interface FixChange {
  field: "Title" | "Description" | "Tags" | "Alt text" | "Link";
  before: string;
  after: string;
  why: string;
}

export interface FixResult {
  content: DraftContent;
  link: string | null;
  changes: FixChange[];
  before: number;
  after: number;
  /** Notes the automatic fix could not handle. */
  manual: QualityCheck[];
}

const LATIN = /^[\p{Script=Latin}\d\s\p{P}\p{S}]*$/u;
const STOP = new Set(["the", "and", "for", "with", "your", "you", "this", "that", "are", "from", "into", "how", "what", "will", "can", "all", "our", "its", "a", "an", "to", "of", "in", "on", "is", "at", "by", "or"]);
const CLAIMS = ["guaranteed", "guarantee", "100%", "miracle", "risk-free", "risk free", "get rich", "overnight results", "doctor recommended", "clinically proven"];
const CLICHES = [
  "elevate your style", "must-have", "must have", "game-changer", "game changer", "look no further", "next level",
  "effortlessly chic", "you won't believe", "you wont believe", "unleash", "in today's world",
];
/** Keep at most this many uses of one word in the description (the check flags 4+). */
const MAX_REPEAT = 3;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const clean = (s: string) =>
  s
    .replace(/\b([\p{L}\p{N}']+)(\s+\1\b)+/giu, "$1")
    .replace(/([!?])[!?]+/g, "$1")
    .replace(/[!?.]+\s*:/g, ":")
    .replace(/([,;:])(\s*[,;:])+/g, "$1")
    .replace(/(^|[.!?]\s+)[,;:]\s*/g, "$1")
    .replace(/\b(and|or|with)\s+(?=[,.!?;:]|$)/gi, "")
    .replace(/\s+([,.!?:;])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

function cutAt(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sentence = head.lastIndexOf(". ");
  if (sentence > max * 0.6) return head.slice(0, sentence + 1);
  return head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : max).replace(/[,;:–—-]\s*$/, "").trim();
}

function unshout(title: string): string {
  return title.replace(/\b[A-Z]{4,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
}

function removeClaims(s: string, words: string[]): string {
  let out = s;
  for (const w of words) out = out.replace(new RegExp(`(^|[^a-z0-9])${esc(w)}(?=[^a-z0-9]|$)`, "gi"), "$1");
  return clean(out);
}

function topicWords(...parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts)
    for (const w of p.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/))
      if (w.length > 3 && !STOP.has(w) && !seen.has(w)) {
        seen.add(w);
        out.push(w);
      }
  return out;
}

const contentWords = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && w !== "it's");

/** Drops extra uses of any word that repeats 4+ times, keeping the first few so the text still reads well. */
function destuff(text: string): { text: string; words: string[] } {
  const counts = new Map<string, number>();
  for (const w of contentWords(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const stuffed = [...counts].filter(([, n]) => n > MAX_REPEAT).map(([w]) => w);
  let out = text;
  for (const w of stuffed) {
    let seen = 0;
    out = out.replace(new RegExp(`(^|[^a-z0-9'-])(${esc(w)})(?=[^a-z0-9'-]|$)`, "gi"), (m, pre: string) => (++seen <= MAX_REPEAT ? m : pre));
  }
  out = clean(out).replace(/(^|[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  return { text: out, words: stuffed };
}

/** Moves the idea's main keyword to the start of a long title, where search and phones show it. */
function keywordFirst(title: string, idea: string): string {
  const primary = idea ? splitIdea(idea).head : "";
  if (!primary) return title;
  const at = title.toLowerCase().indexOf(primary);
  if (at < 0 || at + primary.length <= 40) return title;
  const rest = clean(title.slice(0, at) + " " + title.slice(at + primary.length)).replace(/^[,;:–—-]\s*|\s*[,;:–—-]$/g, "");
  const lead = mainKeyword(primary) || primary;
  return rest ? `${lead}: ${rest}` : lead;
}

export function normaliseLink(url?: string | null): string | null {
  const u = (url ?? "").trim();
  if (!u) return null;
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const parsed = new URL(withScheme.replace(/^http:\/\//i, "https://"));
    return parsed.hostname.includes(".") ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Applies every safe fix to one pin and re-scores it. */
export function autoFixDraft(d: DraftContent, link: string | null | undefined, ctx: FixContext = {}): FixResult {
  const before = reviewDraft(d, { ...ctx, link: link ?? null }).score;
  const changes: FixChange[] = [];
  const idea = (ctx.idea ?? "").trim();
  const english = LATIN.test(`${d.title} ${d.description}`);
  const banned = (ctx.bannedWords ?? []).filter(Boolean);
  const strip = [...(english ? CLAIMS : []), ...banned];

  // Title
  let title = d.title.trim();
  const whyTitle: string[] = [];
  if (!title && idea) {
    title = mainKeyword(idea) || idea;
    whyTitle.push("added a title from your idea");
  }
  if (title) {
    const t0 = title;
    title = removeClaims(unshout(clean(title)), strip);
    if (english) {
      title = tidyTitle(title, idea);
      if (idea) {
        const plain = title.replace(/[!.]+$/, "");
        title = ensureSeoTitle(title, idea, 80);
        const k = mainKeyword(idea);
        if (title.length < 40 && k) {
          const hasK = plain.toLowerCase().includes(k.toLowerCase());
          const options = [hasK ? "" : `${k}: ${plain}`, `${plain}${specificTail(plain, idea)}`, `${k} Ideas: ${plain}`];
          title = options.find((o) => o.length >= 40 && o.length <= 80 && !/\bideas?\b.*\bideas?\b/i.test(o)) ?? title;
        }
      }
    }
    if (english) {
      const tg = removeClaims(title, [...GENERIC_PHRASES, ...CLICHES]);
      if (tg !== title && tg.length >= 15) {
        title = tg;
        whyTitle.push("removed generic wording");
      }
      const tf = keywordFirst(title, idea);
      if (tf !== title && tf.length <= LIMITS.title) {
        title = tf;
        whyTitle.push("main keyword moved to the start");
      }
    }
    title = clean(title);
    if (title.length > LIMITS.title) title = cutAt(title, LIMITS.title);
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title !== t0) {
      if (t0.length < 40 && title.length > t0.length) whyTitle.push(`longer, with the main keyword (${title.length} characters)`);
      else if (t0.length > LIMITS.title) whyTitle.push(`shortened to ${title.length} characters`);
      else if (!whyTitle.length) whyTitle.push("cleaned up spelling, case and keyword");
    }
  }
  if (title !== d.title) changes.push({ field: "Title", before: d.title, after: title, why: whyTitle.join("; ") || "tidied" });

  // Description
  let desc = d.description.trim();
  const whyDesc: string[] = [];
  const d0 = desc;
  const hashtags = [...desc.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].replace(/_/g, " "));
  if (hashtags.length) {
    desc = desc.replace(/\s*#[\p{L}\p{N}_]+/gu, "");
    whyDesc.push("moved hashtags to tags");
  }
  desc = removeClaims(clean(desc), strip);
  if (english && desc) {
    const dg = removeClaims(desc, [...GENERIC_PHRASES, ...CLICHES]);
    if (dg !== desc) {
      desc = dg;
      whyDesc.push("removed generic wording");
    }
  }
  if (english) {
    if (!desc) {
      desc = `${title}.`;
      whyDesc.push("added a description");
    }
    const tk = topicWords(title);
    if (tk.length && !tk.some((w) => desc.toLowerCase().includes(w))) {
      const k = idea ? mainKeyword(idea) : title.replace(/[:.!?].*$/, "");
      desc = /^[A-Z][a-z]/.test(desc) ? `${k}: ${desc.charAt(0).toLowerCase()}${desc.slice(1)}` : `${k}: ${desc}`;
      whyDesc.push("added the title keyword");
    }
    if (desc.length < 100) {
      const topic = (idea ? mainKeyword(idea) : title).toLowerCase().replace(/[.!?:]+$/, "");
      const add = ` Save this pin for easy ${topic} ideas you can come back to.`;
      if ((desc + add).length <= LIMITS.description) {
        desc = (/[.!?…)]$/.test(desc) ? desc : `${desc}.`) + add;
        whyDesc.push("made longer for search");
      }
    }
  }
  const ds = destuff(desc);
  if (ds.words.length) {
    desc = ds.text;
    whyDesc.push(`“${ds.words.join("”, “")}” no longer repeats ${MAX_REPEAT + 1}+ times`);
  }
  if (desc.length > LIMITS.description) {
    desc = cutAt(desc, LIMITS.description);
    whyDesc.push(`shortened to ${LIMITS.description} characters`);
  }
  if (desc && !/[.!?…)。۔]$/.test(desc)) {
    desc = `${desc.replace(/[,;:–—-]+$/, "")}.`;
    whyDesc.push("ends with punctuation");
  }
  if (desc !== d0 && !whyDesc.length) whyDesc.push("tidied spacing and punctuation");
  if (desc !== d.description) changes.push({ field: "Description", before: d.description, after: desc, why: whyDesc.join("; ") });

  // Tags
  const seen = new Set<string>();
  let tags = [...d.tags, ...hashtags].map((t) => t.trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  const whyTags: string[] = [];
  if (tags.length < d.tags.length + hashtags.length) whyTags.push("removed repeats");
  if (tags.length < 3) {
    const pool = [idea.toLowerCase(), ...(ctx.focusKeywords ?? []).map((k) => k.toLowerCase()), ...topicWords(title, idea)];
    for (const p of pool) {
      if (tags.length >= 5) break;
      if (p && p.length <= 60 && !seen.has(p)) {
        tags.push(p);
        seen.add(p);
      }
    }
    whyTags.push("added topics from the title and idea");
  }
  if (tags.length > LIMITS.tags) {
    tags = tags.slice(0, LIMITS.tags);
    whyTags.push(`kept the first ${LIMITS.tags}`);
  }
  if (tags.join("|") !== d.tags.join("|")) changes.push({ field: "Tags", before: d.tags.join(", "), after: tags.join(", "), why: whyTags.join("; ") });

  // Alt text
  let alt = d.alt_text.trim().replace(/^(an?\s+)?(image|picture|photo) of\s+/i, "");
  const fromPrompt = d.image_prompt.split(/(?<=[.!?])\s/)[0]?.replace(/^(an?\s+)?(image|picture|photo) of\s+/i, "").trim() ?? "";
  if (!alt || alt.length < 30 || alt.toLowerCase() === title.toLowerCase()) {
    const better = fromPrompt.length >= 30 ? fromPrompt : d.concept.trim();
    if (better && better.length > alt.length) alt = better;
  }
  alt = cutAt(alt.charAt(0).toUpperCase() + alt.slice(1), LIMITS.alt_text);
  if (alt !== d.alt_text) changes.push({ field: "Alt text", before: d.alt_text, after: alt, why: "describes what the image shows" });

  // Link
  let nextLink = link ?? null;
  if (!nextLink) {
    const site = normaliseLink(ctx.website);
    if (site) {
      nextLink = site;
      changes.push({ field: "Link", before: "", after: site, why: "your brand website" });
    }
  } else if (/^http:\/\//i.test(nextLink)) {
    nextLink = nextLink.replace(/^http:\/\//i, "https://");
    changes.push({ field: "Link", before: link ?? "", after: nextLink, why: "switched to HTTPS" });
  }

  const content: DraftContent = { ...d, title, description: desc, tags, alt_text: alt };
  const report = reviewDraft(content, { ...ctx, link: nextLink });
  const manual = report.checks.filter((c) => c.severity !== "ok");
  return { content, link: nextLink, changes, before, after: report.score, manual };
}

/** Whether "Fix issues" would change anything for this pin. */
export function canAutoFix(d: DraftContent, link: string | null | undefined, ctx: FixContext = {}): boolean {
  return autoFixDraft(d, link, ctx).changes.length > 0;
}
