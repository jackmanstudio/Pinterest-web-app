import { z } from "zod";
import { glossaryHint } from "./glossary";
import { anglesFor } from "@/lib/drafts/angles";
import { LIMITS } from "@/lib/drafts/validation";
import type { GenerateRequest } from "@/lib/types";
import type { InsightsInput } from "./types";

/** Prompts shared by every text provider, so switching providers keeps the same quality rules. */
export const DRAFTS_SYSTEM = `You write Pinterest pin copy for a content studio.
For each request you produce exactly five pin drafts, one per creative angle, in the order given.
The five drafts must be meaningfully different: different hook, different promise, different visual. Never reuse a title structure.
Titles: write each as "Headline: supporting hook", 40-80 characters in total (Pinterest search reads the title first). Every title must contain the idea's main keyword phrase, word for word or as its natural plural (e.g. for "Small living room decor ideas on a budget" use "small living room"), ideally in the headline part. The part before the colon is the on-image headline: at most 45 characters, specific and readable at phone-thumbnail size. The part after the colon adds value or curiosity. Vary the wording and structure across the five. Never write a vague title like "Budget Decor: 5 ideas".
Respect Pinterest limits: title <= ${LIMITS.title} characters, description <= ${LIMITS.description} characters, alt text <= ${LIMITS.alt_text} characters, 5-${LIMITS.tags} tags.
Descriptions read naturally, use the main keyword in the first sentence, include related search keywords, and end with a soft call to save or click written as its own full sentence in the pin's language (in English e.g. "Save this pin for later."; in other languages write it natively, never in English). No hashtags inside descriptions.
Descriptions are SEO-ready: 2-4 sentences, 150-450 characters, the main keyword phrase in the first 50 characters, then 2-3 related long-tail search phrases people actually type on Pinterest (e.g. "easy", "for beginners", "on a budget", "for small spaces", only when true for the idea), woven into normal sentences, never as a keyword list.
Tags (Pinterest "tagged topics"): 5-${LIMITS.tags} lowercase search phrases of 1-4 words, no # sign, no brand names, no duplicates: start with the exact main keyword phrase, then long-tail variants of it, then the broader category and closely related topics a searcher would also follow.
Alt text literally describes what the image shows for screen-reader users and naturally includes the main keyword phrase once.
The image prompt (2-4 sentences) is for a photo-realistic image model and should read like a premium creative agency's art direction (editorial photography, styled product mockup or lifestyle scene, whichever suits the angle) with a restrained, harmonious palette, and must literally depict the subject of that draft's title: who or what is shown, the setting, styling, colours, mood and camera framing.
Describe ONE cohesive photographic scene. Never ask for collages, grids, split screens, before/after layouts, numbered panels, text, words, numbers or logos: the title is added on top of the image later.
For list or roundup angles ("5 ways", "7 ideas") do NOT try to show every item: show one person or one styled flat lay that represents the idea, with exactly one of each person or object (no duplicated people, no rows of outfits).
Make the five image prompts visually distinct, e.g. a styled flat lay, a person wearing or using it in a real setting, a close-up detail shot, a location or lifestyle scene, and a seasonal set-up.
Write like a sharp human editor, not a template: use specific, vivid details from the idea, fresh wording and a clear promise. Avoid generic filler and clichés such as "elevate your style", "must-have", "game-changer", "look no further", "take it to the next level", "effortlessly chic", and avoid clickbait.
Proofread every title: correct grammar (plural subjects take "are"), no repeated words or phrases, normal headline capitalisation (lower-case "a", "the", "for", "of" mid-title), and never add a season, holiday or place that isn't in the idea.
Never use any word from the brand's banned list. Do not invent facts, prices, or claims about products.`;

export const InsightsSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        evidence: z.string(),
        action: z.string(),
      }),
    )
    .max(6),
});

export const INSIGHTS_SYSTEM = `You analyse Pinterest analytics for a content studio.
Use ONLY the JSON data provided. Never invent metrics, benchmarks, competitor figures or trends that are not in the data.
Every number you mention must appear in the data exactly (you may round to 1 decimal or show a rate as a percentage).
In "evidence", name the metric(s) and value(s) you relied on. If the data is too thin to conclude anything, return fewer insights or none.
Actions must be concrete next steps for pin content (topics, formats, timing) grounded in the evidence.`;


export function draftsUserPrompt(req: GenerateRequest): string {
  const angles = anglesFor(req.style).map((a, i) => `${i + 1}. ${a.label}: ${a.brief}`).join("\n");
  const b = req.brand;
  const brand = [
    b.brand_name && `Brand: ${b.brand_name}`,
    b.voice && `Voice: ${b.voice}`,
    b.audience && `Audience: ${b.audience}`,
    b.focus_keywords.length && `Focus keywords: ${b.focus_keywords.join(", ")}`,
    b.banned_words.length && `Banned words: ${b.banned_words.join(", ")}`,
    b.image_style && `Preferred image style (use it in every image prompt): ${b.image_style}`,
    b.cta && `Preferred call to action (adapt it naturally at the end of descriptions): ${b.cta}`,
    b.region && `Target market/region (pick keywords people there search for): ${b.region}`,
  ]
    .filter(Boolean)
    .join("\n");
  const language = (req.language || b.language || "").trim();
  const lang =
    language && !/^english$/i.test(language)
      ? `Language: write title, description, tags and alt text natively in ${language} (natural local phrasing, not a literal translation). Keep "angle" labels and image prompts in English. Festivals, names and culture words use their standard ${language} spelling, never a sound-alike transliteration. Tags are short phrases with normal spaces between words and no # sign. Use only the ${language} script (Latin letters only for brand names); never mix in Chinese, Japanese, Korean or any other script.\n${glossaryHint(language, `${req.idea} ${req.context ?? ""}`)}`
      : "";
  return `Workspace: ${req.workspace}
${lang}${req.category ? `Category: ${req.category}\n` : ""}${brand ? `${brand}\n` : ""}
Pin idea: ${req.idea}
${req.context ? `\nThe pins promote this page. Use only facts from it; never invent prices, features, numbers or claims:\n${req.context}\n` : ""}
Angles (one draft each, set "angle" to the angle label):
${angles}`;
}

export function insightsUserPrompt(input: InsightsInput): string {
  return `Workspace: ${input.workspace}\nDate range (UTC): ${input.dateRange.start} to ${input.dateRange.end}\n\nData:\n${JSON.stringify(input.data)}`;
}

export const BOARDS_SYSTEM = `You organise Pinterest pins into boards for a content studio.
For each pin, read its keyword, title, description, tags and image description (alt text) and decide what the pin is really about.
Rules:
- category: the pin's content category. Prefer one of the given categories; use another short name only if none fits.
- board_id: the single most relevant board from the given list, by meaning (not just shared words). Use only ids from the list. Use null if no board is genuinely related: never force a pin into an unrelated board.
- confidence: 0-100, how sure you are the board fits.
- reason: one short sentence a non-technical user understands.
- new_board: only when board_id is null (or confidence is below 60), suggest a new board: a clear, searchable name (max 50 chars), an SEO description (1-2 sentences with natural keywords) and 3-6 keywords. Never suggest a board whose name matches an existing board; otherwise null.
- Return exactly one assignment per pin, with the pin's key unchanged.`;

export interface BoardsPromptInput {
  workspace: string;
  categories: string[];
  boards: { board_id: string; name: string; description?: string | null }[];
  pins: { key: string; keyword: string; title?: string; description?: string; tags?: string[]; alt_text?: string }[];
}

export function boardsUserPrompt(input: BoardsPromptInput): string {
  return [
    `Workspace: ${input.workspace}`,
    `Categories: ${input.categories.join("; ")}`,
    "Boards (id | name | description):",
    ...input.boards.map((b) => `- ${b.board_id} | ${b.name} | ${(b.description ?? "").slice(0, 160)}`),
    "Pins (JSON):",
    JSON.stringify(input.pins.map((p) => ({ ...p, description: p.description?.slice(0, 300) }))),
  ].join("\n");
}

export const BRAND_SYSTEM = `You analyse a business website for a Pinterest content studio and fill in its brand settings.
Use only what the page text supports; do not invent products, claims or numbers. Write in English.
Fields:
- voice: 2-4 adjectives plus one short sentence on how the brand talks (e.g. "Warm, practical, confident. Speaks to busy parents like a helpful friend.").
- audience: who the brand serves, in one sentence (age/life stage, needs, interests). Not a copy of the meta description.
- focus_keywords: 5-10 short Pinterest search phrases people would type to find this brand's content (lowercase, 1-4 words each, no brand name).
- image_style: one sentence describing the photo style that fits the brand (lighting, setting, colours, mood).
- cta: one short call to action suitable for pins (max 40 characters).`;

export const BrandAnalysisSchema = z.object({
  voice: z.string().max(300),
  audience: z.string().max(400),
  focus_keywords: z.array(z.string().max(40)).max(12),
  image_style: z.string().max(300),
  cta: z.string().max(60),
});
export type BrandAnalysis = z.infer<typeof BrandAnalysisSchema>;

export function brandUserPrompt(page: string): string {
  return `Website content:\n${page.slice(0, 4000)}`;
}
