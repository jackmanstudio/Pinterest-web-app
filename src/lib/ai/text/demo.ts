import { PIN_ANGLES, anglesFor, type PinAngleKey } from "@/lib/drafts/angles";
import { LIMITS } from "@/lib/drafts/validation";
import type { DraftContent, GenerateRequest, GenerateResponse } from "@/lib/types";
import type { TextProvider } from "./types";

/**
 * Template-based stand-in used when no TEXT_AI_API_KEY is configured.
 * Output is always returned with source "demo" so the UI labels it.
 */
export class DemoTextProvider implements TextProvider {
  readonly name = "Demo templates (no AI)";
  readonly source = "demo" as const;

  async generateDrafts(req: GenerateRequest): Promise<GenerateResponse> {
    return {
      source: "demo",
      provider: this.name,
      model: null,
      drafts: !req.style || req.style === "mixed" ? PIN_ANGLES.map((a) => demoDraft(a.key, a.label, req)) : anglesFor(req.style).map((a) => styleDraft(a, req)),
    };
  }
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with", "vs"]);
/** Headline case: capitalise words, keep short joining words lower-case (except the first). */
export const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

function demoDraft(key: PinAngleKey, label: string, req: GenerateRequest): DraftContent {
  const idea = req.idea.trim();
  // Keep the idea short in titles so the angle-specific wording always fits.
  const Idea = titleCase(clip(idea.split(/\s+/).slice(0, 6).join(" "), 40));
  const brand = req.brand.brand_name || "our studio";
  const audience = req.brand.audience || "anyone who loves this look";
  const cat = req.category ? ` (${req.category})` : "";
  const season = currentSeason();

  const byAngle: Record<PinAngleKey, Omit<DraftContent, "angle" | "tags">> = {
    how_to: {
      concept: `Step-by-step guide showing how to recreate "${idea}" at home${cat}.`,
      title: `${Idea}: A Simple 4-Step Guide`,
      description: `Save this step-by-step guide to ${idea}. We break it into four simple steps ${audience} can follow today, with the small details that make the difference. More guides from ${brand}.`,
      alt_text: `Overhead flat lay of the items needed for ${idea}, neatly arranged on light linen in soft window light.`,
      image_prompt: `Overhead styled flat lay of everything needed for ${idea}, neatly arranged on a light linen surface, soft natural window light.`,
    },
    list: {
      concept: `A numbered roundup of 7 variations on "${idea}".`,
      title: `7 Fresh Ideas for ${Idea}`,
      description: `Seven fresh takes on ${idea}, from easy everyday options to standout statement versions. Pick your favourite and pin the rest for later. Curated by ${brand}.`,
      alt_text: `A stylish person showing ${idea} on a sunlit city street, full-length.`,
      image_prompt: `A stylish person showcasing ${idea} on a sunlit city street, full-length shot, confident relaxed pose, cohesive neutral palette.`,
    },
    inspiration: {
      concept: `Mood-led hero image that sells the feeling of "${idea}".`,
      title: `${Idea}: Calm, Everyday Inspiration`,
      description: `Let this be your sign to try ${idea}. A calm, aspirational take for ${audience}, made to inspire your next board. Explore more moods from ${brand}.`,
      alt_text: `Warm golden-hour photo with a soft background that captures the mood of ${idea}.`,
      image_prompt: `Cinematic hero shot evoking ${idea}, shallow depth of field, warm golden-hour tones, calm and aspirational mood.`,
    },
    problem_solution: {
      concept: `Names a common frustration, then shows "${idea}" as the fix.`,
      title: `${Idea} Without the Guesswork`,
      description: `If you keep running into the same problem, ${idea} might be exactly what you need. Here is why it works and how to start without overthinking it. Tips from ${brand}.`,
      alt_text: `Close-up detail of ${idea}, showing texture on a clean, bright background.`,
      image_prompt: `Close-up detail shot of ${idea}, showing texture and craftsmanship, bright and fresh, clean background.`,
    },
    seasonal: {
      concept: `Frames "${idea}" as a must-try for ${season}.`,
      title: new RegExp(season, "i").test(idea) ? `${Idea}: Save This for Later` : `${Idea} This ${titleCase(season)}`,
      description: `${titleCase(season)} is the perfect moment for ${idea}. Pin this now so it is ready when you need it, and check back for more seasonal picks from ${brand}.`,
      alt_text: `Cosy ${season} lifestyle scene featuring ${idea} with seasonal props and warm colours.`,
      image_prompt: `A cosy ${season} lifestyle scene centred on ${idea}, seasonal props and colours, warm editorial styling.`,
    },
  };

  const base = byAngle[key];
  // Search-style tags: the full keyword phrase first, then long-tail variants people type, then brand focus keywords.
  const kw = idea.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  const ANGLE_TAG: Record<PinAngleKey, string> = { how_to: "how to", list: "ideas", inspiration: "inspiration", problem_solution: "tips", seasonal: season };
  const tail = ANGLE_TAG[key];
  const tags = [
    kw,
    key === "how_to" ? `${kw} guide` : key === "seasonal" ? `${season} ${kw}` : `${kw} ${tail}`,
    `${kw} ideas`,
    req.category ? req.category.toLowerCase() : "",
    ...req.brand.focus_keywords.slice(0, 3).map((k) => k.toLowerCase()),
    `${req.workspace} ideas`,
  ].filter((t) => t && t.length <= 60);
  return {
    angle: label,
    concept: base.concept,
    title: clip(base.title, LIMITS.title),
    description: clip(base.description, LIMITS.description),
    alt_text: clip(base.alt_text, LIMITS.alt_text),
    image_prompt: base.image_prompt,
    tags: [...new Set(tags)].slice(0, LIMITS.tags),
  };
}

function currentSeason(d = new Date()): string {
  const m = d.getMonth();
  return m < 2 || m === 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "autumn";
}

/** Demo text for the pin sets (roundup, comparison, gift guide, curiosity). */
function styleDraft(a: { key: string; label: string; brief: string; demo?: string }, req: GenerateRequest): DraftContent {
  const idea = req.idea.trim();
  const Idea = titleCase(clip(idea.split(/\s+/).slice(0, 6).join(" "), 40));
  const brand = req.brand.brand_name || "our studio";
  const title = (a.demo ?? `${a.label}: {Idea}`).replace("{Idea}", Idea);
  const shots = ["styled flat lay of several items side by side on linen", "two options arranged side by side on a clean table", "gift-wrapped items with ribbon and a handwritten tag", "close-up detail with soft window light", "lifestyle scene with a person choosing between items"];
  const shot = shots[(a.key.length + idea.length) % shots.length];
  return {
    angle: a.label,
    concept: `${a.label}: ${a.brief}`,
    title: clip(title, LIMITS.title),
    description: clip(`${a.brief.replace(/\.$/, "")} for ${idea}. Save this pin so you have it when you need it. More ideas from ${brand}.`, LIMITS.description),
    alt_text: clip(`Photo of ${idea}: ${shot}.`, LIMITS.alt_text),
    image_prompt: `Editorial photo of ${idea}: ${shot}, restrained palette, soft natural light.`,
    tags: [...new Set([...idea.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 3), a.key.split("_")[0], req.workspace])].slice(0, LIMITS.tags),
  };
}
