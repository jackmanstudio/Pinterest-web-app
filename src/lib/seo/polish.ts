import { LIMITS } from "@/lib/drafts/validation";
import { buildKeywordPlan, mentions, type KeywordPlan, type KeywordPlanInput } from "./keywords";

const isEnglish = (language?: string | null) => !language || /^english$/i.test(language.trim());

/** A tag Pinterest can use: lowercase, no #, single spaces, 1-6 words, at most 60 characters. */
export function cleanTag(t: string): string {
  return t.replace(/^#+/, "").replace(/[#_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60);
}

/**
 * Safe SEO clean-up after the AI writes the copy. It never rewrites the
 * writing; it only fixes tags and alt text mechanically:
 * - tags: cleaned, deduped, at most 10; for English pins the primary keyword
 *   leads and thin tag lists are topped up from the keyword research (only
 *   phrases built from the idea itself, so nothing untrue is added).
 * - alt text: drops "image of / photo of" openers.
 * - description: removes stray hashtags (tags carry those).
 */
export function polishSeo<T extends { title: string; description: string; tags: string[]; alt_text: string }>(
  drafts: T[],
  input: KeywordPlanInput & { language?: string | null },
  plan: KeywordPlan = buildKeywordPlan(input),
): T[] {
  const english = isEnglish(input.language);
  return drafts.map((d, i) => {
    let tags = [...new Set(d.tags.map(cleanTag).filter((t) => t && t.split(" ").length <= 6))];
    if (english && plan.primary) {
      tags = [plan.primary, ...tags.filter((t) => t !== plan.primary)];
      // Top up thin lists with phrases that are true by construction: the idea's own long tail,
      // then a related search that shares a word with this pin's copy. Rotate so pins differ.
      const text = `${d.title} ${d.description}`;
      const pool = [...plan.longTail.slice(0, 2), ...plan.related.filter((r) => r.split(" ").some((w) => w.length > 3 && mentions(text, w)))];
      for (let k = 0; tags.length < 5 && k < pool.length; k++) {
        const t = pool[(k + i) % pool.length];
        if (!tags.includes(t)) tags.push(t);
      }
    }
    const alt = d.alt_text.replace(/^\s*(?:an?\s+)?(?:image|picture|photo|photograph)\s+(?:of|showing)\s+/i, "").trim();
    const description = d.description.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").replace(/\s{2,}/g, " ").trim();
    return {
      ...d,
      tags: tags.slice(0, LIMITS.tags),
      alt_text: alt ? alt.charAt(0).toUpperCase() + alt.slice(1) : d.alt_text,
      description: description || d.description,
    };
  });
}
