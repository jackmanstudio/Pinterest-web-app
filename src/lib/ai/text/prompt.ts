import { z } from "zod";
import { glossaryHint } from "./glossary";
import { anglesFor } from "@/lib/drafts/angles";
import { LIMITS } from "@/lib/drafts/validation";
import type { GenerateRequest } from "@/lib/types";
import type { InsightsInput } from "./types";
import { buildKeywordPlan, GENERIC_PHRASES, keywordBrief } from "@/lib/seo/keywords";
import { detectEvents } from "@/lib/seo/seasonality";


/** Prompts shared by every text provider, so switching providers keeps the same quality rules. */
export const DRAFTS_SYSTEM = `You write Pinterest pin copy for a content studio.
For each request you produce exactly five pin drafts, one per creative angle, in the order given.
The five drafts must be meaningfully different: different hook, different promise, different visual. Never reuse a title structure.
Titles: write each as "Headline: supporting hook", 40-80 characters in total (Pinterest search reads the title first). Every title must contain the primary keyword from the keyword research, word for word or as its natural plural, inside its first 40 characters (front-load it; e.g. for "Small living room decor ideas on a budget" start with "Small Living Room Decor"). The part before the colon is the on-image headline: at most 45 characters, specific and readable at phone-thumbnail size. The part after the colon adds value or curiosity. Vary the wording and structure across the five. Never write a vague title like "Budget Decor: 5 ideas".
No generic copy: every hook and every description must name something concrete that is specific to THAT draft and its image (a material, colour, item, technique, number, room, dish, audience or result), so it could not be pasted onto another pin. Never use filler such as "${GENERIC_PHRASES.slice(0, 12).join('", "')}". No two drafts may share a hook, an opening sentence or a closing sentence.
Respect Pinterest limits: title <= ${LIMITS.title} characters, description <= ${LIMITS.description} characters, alt text <= ${LIMITS.alt_text} characters, 5-${LIMITS.tags} tags.
Descriptions read naturally, use the main keyword in the first sentence, include related search keywords, and end with a soft call to save or click written as its own full sentence in the pin's language that names what they are saving (in English e.g. "Save these five layouts for your next living room refresh.", not a bare "Save this pin for later."; in other languages write it natively, never in English). No hashtags inside descriptions.
Descriptions are SEO-ready: 2-4 sentences, 150-450 characters, the primary keyword in the first 50 characters, then 2-4 secondary phrases from the keyword research (trending and long-tail first, only the ones that are true for this pin), woven into normal sentences, never as a keyword list. Say what the reader gets from THIS pin (what is shown, how it works, who it suits). No phrase more than twice.
Tags (Pinterest "tagged topics"): 5-${LIMITS.tags} lowercase search phrases of 1-4 words, no # sign, no brand names, no duplicates: the primary keyword first, then the trending and long-tail phrases that fit this draft, then related niche searches. Pick a slightly different mix for each draft.
Alt text: one or two plain sentences (80-250 characters) that literally describe what this draft's image shows (subject, setting, colours, action) for screen-reader users, with the primary keyword once. Do not start with "image of" or "photo of", and do not copy the title or add marketing words.
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


/** Pin copy for the user's own photos: one pin per photo, describing what is really in it. */
export const PHOTO_SYSTEM = `You write Pinterest pin copy for photos the user took or owns.
You get up to five photos, numbered in order, plus an optional topic and brand notes. Write exactly one pin per photo, in the same order.
Look at each photo and describe only what is really visible. Never invent products, prices, places, brands or claims that the photo and notes don't support.
Title: "Headline: supporting hook", 40-80 characters, starting with the main search phrase people would type for this photo (use the keyword research when given). No clickbait. The hook names something concrete you can see in that photo; never generic filler like "worth saving", "save and try" or "you'll love".
Description: 2-3 natural sentences (150-${LIMITS.description} characters) about what is in that photo, so it helps someone decide to save or click; the main search phrase in the first sentence, then 2-3 other search phrases from the keyword research that are true for the photo, no keyword lists, no hashtags inside the text. Every description must be different.
Tags: 5-${LIMITS.tags} lowercase search phrases of 1-4 words (no # sign): the main search phrase first, then long-tail and related ones that match the photo.
Alt text: one plain sentence describing the photo for someone who can't see it (max 200 characters), not starting with "image of" or "photo of".
If a photo is unclear, describe what you can see and keep the copy general.`;

export const PhotoPinSetSchema = z.object({
  pins: z.array(
    z.object({
      title: z.string().min(1).max(LIMITS.title),
      description: z.string().min(1).max(LIMITS.description),
      tags: z.array(z.string().min(1)).min(1).max(LIMITS.tags),
      alt_text: z.string().min(1).max(LIMITS.alt_text),
    }),
  ),
});
export type PhotoPinText = z.infer<typeof PhotoPinSetSchema>["pins"][number];

export interface PhotoPinsInput {
  photos: { topic: string }[];
  topic: string;
  language?: string;
  brand: GenerateRequest["brand"];
  trendKeywords?: string[];
}

export function photoUserPrompt(input: PhotoPinsInput): string {
  const b = input.brand;
  const lines = [
    input.topic && `Topic for all photos: ${input.topic}`,
    input.language && input.language.toLowerCase() !== "english" && `Write in ${input.language}.`,
    b.brand_name && `Brand: ${b.brand_name}`,
    b.voice && `Voice: ${b.voice}`,
    b.audience && `Audience: ${b.audience}`,
    b.focus_keywords.length && `Focus keywords (use only where they fit the photo): ${b.focus_keywords.join(", ")}`,
    b.banned_words.length && `Never use: ${b.banned_words.join(", ")}`,
    ...input.photos.map((p, i) => `Photo ${i + 1}${p.topic ? ` (user note: ${p.topic})` : ""}`),
    input.topic && keywordBrief(buildKeywordPlan({ idea: input.topic, trendKeywords: input.trendKeywords, focusKeywords: b.focus_keywords }), { language: input.language }),
  ].filter(Boolean);
  return `${lines.join("\n")}\n\nReturn ${input.photos.length} pins, one per photo, in order.`;
}

/**
 * The same rules for writing ONE draft. Pins of a set are written in parallel (one call per angle),
 * which is several times faster than one long call; each call knows the set's other angles.
 */
export const DRAFT_ONE_SYSTEM = DRAFTS_SYSTEM.replace(
  /For each request you produce exactly five pin drafts, one per creative angle, in the order given\.\nThe five drafts must be meaningfully different: different hook, different promise, different visual\. Never reuse a title structure\./,
  "For each request you produce exactly one pin draft (a drafts array with one item), for the one creative angle you are given.\nThe other pins of the set are written at the same time for the other listed angles, so yours must be clearly different from them: its own hook, promise, title structure and visual, true to its angle.",
).replace(/across the five|the five drafts|the five image prompts/g, (m) => (m === "the five image prompts" ? "the image prompts of the set" : m === "the five drafts" ? "the drafts of the set" : "across the set"));

export function draftsUserPrompt(req: GenerateRequest, only?: number): string {
  const all = anglesFor(req.style);
  const angles =
    only === undefined
      ? all.map((a, i) => `${i + 1}. ${a.label}: ${a.brief}`).join("\n")
      : `Write ONE draft for this angle (set "angle" to its label):\n${all[only].label}: ${all[only].brief}\nOther pins in this set (written separately; do not repeat their hook or visual): ${all
          .filter((_, i) => i !== only && i < (req.count ?? all.length))
          .map((a) => a.label)
          .join("; ") || "none"}`;
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
  const plan = buildKeywordPlan({ idea: req.idea, category: req.category, trendKeywords: req.trend_keywords, focusKeywords: b.focus_keywords });
  const keywords = keywordBrief(plan, { language, ideaIsSeasonal: detectEvents(req.idea).length > 0 });
  return `Workspace: ${req.workspace}
${lang}${req.category ? `Category: ${req.category}\n` : ""}${brand ? `${brand}\n` : ""}
Pin idea: ${req.idea}

${keywords}
${req.context ? `\nThe pins promote this page. Use only facts from it; never invent prices, features, numbers or claims:\n${req.context}\n` : ""}
${only === undefined ? `Angles (one draft each, set "angle" to the angle label):\n` : ""}${angles}`;
}

export function insightsUserPrompt(input: InsightsInput): string {
  return `Workspace: ${input.workspace}\nDate range (UTC): ${input.dateRange.start} to ${input.dateRange.end}\n\nData:\n${JSON.stringify(input.data)}`;
}

export const BOARDS_SYSTEM = `You organise Pinterest pins into boards for a content studio.
For each pin, read its keyword, title, description, tags and image description (alt text) and decide what the pin is really about.
Rules:
- category: the pin's content category. Prefer one of the given categories; use another short name only if none fits.
- board_id: the single most relevant board from the given list, by meaning (not just shared words). A board's category (set by the user or detected) is a strong hint: prefer a board whose category matches the pin's. Use only ids from the list. Use null if no board is genuinely related: never force a pin into an unrelated board.
- confidence: 0-100, how sure you are the board fits.
- reason: one short sentence a non-technical user understands.
- new_board: only when board_id is null (or confidence is below 60), suggest a new board: a clear, searchable name (max 50 chars), an SEO description (1-2 sentences with natural keywords) and 3-6 keywords. Never suggest a board whose name matches an existing board; otherwise null.
- Return exactly one assignment per pin, with the pin's key unchanged.`;

export interface BoardsPromptInput {
  workspace: string;
  categories: string[];
  boards: { board_id: string; name: string; description?: string | null; category?: string | null }[];
  pins: { key: string; keyword: string; title?: string; description?: string; tags?: string[]; alt_text?: string }[];
}

export function boardsUserPrompt(input: BoardsPromptInput): string {
  return [
    `Workspace: ${input.workspace}`,
    `Categories: ${input.categories.join("; ")}`,
    "Boards (id | name | category | description):",
    ...input.boards.map((b) => `- ${b.board_id} | ${b.name} | ${b.category ?? ""} | ${(b.description ?? "").slice(0, 160)}`),
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
