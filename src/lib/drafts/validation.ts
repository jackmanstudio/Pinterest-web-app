import { PIN_STYLE_KEYS, type PinStyle } from "./angles";
import { z } from "zod";
import { WORKSPACE_KINDS } from "@/lib/types";

/** Pinterest field limits (title 100, description 500, alt text 500). */
export const LIMITS = { title: 100, description: 500, alt_text: 500, tags: 10, idea: 500 } as const;

export const DraftContentSchema = z.object({
  angle: z.string(),
  concept: z.string().min(1),
  title: z.string().min(1).max(LIMITS.title),
  description: z.string().min(1).max(LIMITS.description),
  tags: z.array(z.string().min(1)).min(1).max(LIMITS.tags),
  alt_text: z.string().min(1).max(LIMITS.alt_text),
  image_prompt: z.string().min(1),
});

export const DraftSetSchema = z.object({
  drafts: z.array(DraftContentSchema).length(5),
});

const BrandSchema = z.object({
  brand_name: z.string().max(120),
  voice: z.string().max(500),
  audience: z.string().max(500),
  website_url: z.string().max(300),
  focus_keywords: z.array(z.string().max(60)).max(30),
  banned_words: z.array(z.string().max(60)).max(50),
  image_style: z.string().max(120).optional(),
  cta: z.string().max(120).optional(),
  language: z.string().max(40).optional(),
  region: z.string().max(60).optional(),
});

export const GenerateRequestSchema = z.object({
  workspace: z.enum(WORKSPACE_KINDS),
  idea: z.string().trim().min(3, "Describe the pin idea in a few words").max(LIMITS.idea),
  category: z.string().max(170).optional(),
  language: z.string().max(40).optional(),
  brand: BrandSchema,
  context: z.string().max(2000).optional(),
  style: z.enum(PIN_STYLE_KEYS as [PinStyle, ...PinStyle[]]).optional(),
});

/** Turn "a, b,  c" into ["a","b","c"] (trimmed, deduped, no empties). */
export function parseList(input: string): string[] {
  const out: string[] = [];
  const lower = new Set<string>();
  for (const raw of input.split(",")) {
    const v = raw.trim();
    if (v && !lower.has(v.toLowerCase())) {
      lower.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}
