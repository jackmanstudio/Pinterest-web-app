import type { WorkspaceNiche } from "@/lib/types";

/**
 * Seasonal topic suggestions used when live Pinterest Trends aren't available.
 * These are calendar-based suggestions, NOT trend data, and the UI says so.
 */
const FASHION: Record<number, string[]> = {
  0: ["Winter capsule wardrobe", "Cosy knitwear outfits", "New year closet reset"],
  1: ["Valentine's date night outfits", "Late winter layering", "Galentine's brunch looks"],
  2: ["Spring transition outfits", "Trench coat styling", "Pastel outfit ideas"],
  3: ["Easter outfit ideas", "Spring capsule wardrobe", "Rainy day outfits"],
  4: ["Wedding guest dresses", "Mother's Day gift ideas", "Linen outfits"],
  5: ["Summer vacation outfits", "Festival outfits", "Father's Day gift guide"],
  6: ["Beach day outfits", "Heatwave outfits for work", "Summer white outfits"],
  7: ["Back to school outfits", "Late summer to fall transition", "Fall wardrobe essentials"],
  8: ["Fall outfit ideas", "Autumn layering", "Fall capsule wardrobe"],
  9: ["Halloween costume ideas", "Cosy autumn outfits", "Boots styling guide"],
  10: ["Thanksgiving outfit ideas", "Black Friday wishlist", "Holiday gift guide for her"],
  11: ["Holiday party outfits", "New Year's Eve outfits", "Last-minute gift ideas"],
};
const GENERAL: Record<number, string[]> = {
  0: ["New year goals", "January reset checklist"],
  1: ["Valentine's Day ideas"],
  2: ["Spring planning checklist"],
  3: ["Spring refresh ideas"],
  4: ["Mid-year planning"],
  5: ["Summer planning guide"],
  6: ["Mid-year review"],
  7: ["Back to school planning"],
  8: ["Autumn planning checklist"],
  9: ["Q4 planning guide"],
  10: ["Black Friday guide", "Year-end checklist"],
  11: ["Year in review", "Next year planning guide"],
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function seasonalIdeas(kind: WorkspaceNiche, date: Date, focusKeywords: string[] = []): string[] {
  const m = date.getMonth();
  const next = (m + 1) % 12;
  const fromKeywords = focusKeywords.slice(0, 3).flatMap((k) => [`${k}: ${MONTHS[m]} guide`, `${k} ideas for ${MONTHS[next]}`]);
  // Pinterest users plan ahead, so include next month's themes too.
  const calendar = kind === "fashion" ? [...FASHION[m], ...FASHION[next].slice(0, 2)] : [...GENERAL[m], ...GENERAL[next]];
  return [...new Set([...fromKeywords, ...calendar])].slice(0, 8);
}
