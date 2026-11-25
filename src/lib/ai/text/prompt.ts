import { z } from "zod";
import { PIN_ANGLES } from "@/lib/drafts/angles";
import { LIMITS } from "@/lib/drafts/validation";
import type { GenerateRequest } from "@/lib/types";
import type { InsightsInput } from "./types";

/** Prompts shared by every text provider, so switching providers keeps the same quality rules. */
export const DRAFTS_SYSTEM = `You write Pinterest pin copy for a content studio.
For each request you produce exactly five pin drafts, one per creative angle, in the order given.
The five drafts must be meaningfully different: different hook, different promise, different visual. Never reuse a title structure.
Titles: write each as "Short headline: supporting hook". The part before the colon is the on-image headline: at most 45 characters, specific and punchy, readable at phone-thumbnail size. The part after the colon adds value or curiosity. Vary the wording and structure across the five.
Respect Pinterest limits: title <= ${LIMITS.title} characters, description <= ${LIMITS.description} characters, alt text <= ${LIMITS.alt_text} characters, 3-${LIMITS.tags} tags.
Descriptions read naturally, include relevant search keywords, and end with a soft call to save or click. No hashtags inside descriptions.
Alt text literally describes what the image shows for screen-reader users.
The image prompt (2-4 sentences) is for a photo-realistic image model and should read like a premium creative agency's art direction (editorial photography, styled product mockup or lifestyle scene, whichever suits the angle) with a restrained, harmonious palette, and must literally depict the subject of that draft's title: who or what is shown, the setting, styling, colours, mood and camera framing.
Describe ONE cohesive photographic scene. Never ask for collages, grids, split screens, before/after layouts, numbered panels, text, words, numbers or logos: the title is added on top of the image later.
Make the five image prompts visually distinct, e.g. a styled flat lay, a person wearing or using it in a real setting, a close-up detail shot, a location or lifestyle scene, and a seasonal set-up.
Write like a sharp human editor, not a template: use specific, vivid details from the idea, fresh wording and a clear promise. Avoid generic filler and clichés such as "elevate your style", "must-have", "game-changer", "look no further", "take it to the next level", "effortlessly chic", and avoid clickbait.
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
  const angles = PIN_ANGLES.map((a, i) => `${i + 1}. ${a.label}: ${a.brief}`).join("\n");
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
      ? `Language: write title, description, tags and alt text natively in ${language} (natural local phrasing, not a literal translation). Keep "angle" labels and image prompts in English.\n`
      : "";
  return `Workspace: ${req.workspace}
${lang}${req.category ? `Category: ${req.category}\n` : ""}${brand ? `${brand}\n` : ""}
Pin idea: ${req.idea}

Angles (one draft each, set "angle" to the angle label):
${angles}`;
}

export function insightsUserPrompt(input: InsightsInput): string {
  return `Workspace: ${input.workspace}\nDate range (UTC): ${input.dateRange.start} to ${input.dateRange.end}\n\nData:\n${JSON.stringify(input.data)}`;
}
