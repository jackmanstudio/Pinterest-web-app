/**
 * Five deliberately different creative angles. Each generation asks for exactly
 * one draft per angle so the five pins differ in intent, not just wording.
 */
export const PIN_ANGLES = [
  {
    key: "how_to",
    label: "How-to / tutorial",
    brief: "A practical step-by-step pin that teaches the viewer to do or recreate something.",
  },
  {
    key: "list",
    label: "List / roundup",
    brief: "A numbered roundup (e.g. '7 ways…') that promises several options in one save.",
  },
  {
    key: "inspiration",
    label: "Inspiration / mood",
    brief: "An aspirational, visual-first pin that sells a feeling or aesthetic, light on instructions.",
  },
  {
    key: "problem_solution",
    label: "Problem → solution",
    brief: "Opens with a specific pain point the audience has, then presents the idea as the fix.",
  },
  {
    key: "seasonal",
    label: "Seasonal / timely",
    brief: "Ties the idea to a season, event or current moment so it feels urgent to save now.",
  },
] as const;

export type PinAngleKey = (typeof PIN_ANGLES)[number]["key"];

export interface StyleAngle {
  key: string;
  label: string;
  brief: string;
  /** Demo-mode headline; {Idea} is replaced with the idea. */
  demo: string;
}

/**
 * Pin sets. "mixed" is the default five creative angles; the others give five
 * different takes on one format (roundup, comparison, gift guide, curiosity).
 * In every set, the five pins still get five different layouts.
 */
export const PIN_STYLES = {
  mixed: { label: "Mixed angles", hint: "How-to, list, inspiration, problem/solution, seasonal" },
  roundup: { label: "Product roundup", hint: "2-6 products or picks in each pin" },
  comparison: { label: "Comparison", hint: "A vs B, pros and cons, which one to choose" },
  gift_guide: { label: "Gift guide", hint: "Gifts by person, budget and occasion" },
  curiosity: { label: "Curiosity & tips", hint: "Mistakes, myths, little-known tips" },
} as const;
export type PinStyle = keyof typeof PIN_STYLES;
export const PIN_STYLE_KEYS = Object.keys(PIN_STYLES) as PinStyle[];

const STYLE_ANGLES: Record<Exclude<PinStyle, "mixed">, StyleAngle[]> = {
  roundup: [
    { key: "roundup_shop", label: "Roundup: shop the look", brief: "3-5 specific pieces or products that work together, each named in the description.", demo: "Shop the Look: {Idea}" },
    { key: "roundup_best", label: "Roundup: best picks", brief: "A numbered 'best of' roundup (e.g. '6 best…') with a one-line reason for each pick.", demo: "6 Best Picks for {Idea}" },
    { key: "roundup_budget", label: "Roundup: budget picks", brief: "Affordable options; mention the price range only if it was given, never invent prices.", demo: "{Idea} on a Budget" },
    { key: "roundup_editor", label: "Roundup: editor's favourites", brief: "A curated, opinionated short list with a clear point of view.", demo: "Our Favourite {Idea} Right Now" },
    { key: "roundup_trending", label: "Roundup: trending now", brief: "What's popular this season, framed as timely picks to save now.", demo: "Trending Now: {Idea}" },
  ],
  comparison: [
    { key: "cmp_vs", label: "Comparison: A vs B", brief: "Head-to-head of two clear options (from the idea) with the key difference in the headline.", demo: "{Idea}: Which One Wins?" },
    { key: "cmp_pros", label: "Comparison: pros and cons", brief: "Honest pros and cons of each option, balanced, no invented specs.", demo: "{Idea}: Pros and Cons" },
    { key: "cmp_choose", label: "Comparison: which is right for you", brief: "Helps the viewer pick based on their situation (budget, style, use).", demo: "{Idea}: Which Is Right for You?" },
    { key: "cmp_value", label: "Comparison: value check", brief: "Is the pricier option worth it? Compare value, durability and use.", demo: "Is It Worth It? {Idea}" },
    { key: "cmp_verdict", label: "Comparison: the verdict", brief: "A clear recommendation with the one reason that decides it.", demo: "{Idea}: Our Honest Verdict" },
  ],
  gift_guide: [
    { key: "gift_her", label: "Gift guide: for her", brief: "Gift ideas for a woman in the viewer's life, specific and thoughtful.", demo: "{Idea}: Gifts She'll Love" },
    { key: "gift_him", label: "Gift guide: for him", brief: "Gift ideas for a man, practical and personal.", demo: "{Idea}: Gifts for Him" },
    { key: "gift_budget", label: "Gift guide: under a budget", brief: "Gifts under a price point (only if a price is given; otherwise say 'affordable').", demo: "Affordable {Idea} Gift Ideas" },
    { key: "gift_lastminute", label: "Gift guide: last-minute", brief: "Easy last-minute gifts that still feel considered.", demo: "Last-Minute {Idea} Gifts" },
    { key: "gift_occasion", label: "Gift guide: by occasion", brief: "Tied to an occasion (Eid, birthday, wedding, holidays) that fits the idea.", demo: "{Idea}: Gifts for Every Occasion" },
  ],
  curiosity: [
    { key: "cur_mistakes", label: "Curiosity: common mistakes", brief: "Mistakes people make and the quick fix for each (a common problem → solution).", demo: "{Idea}: Mistakes to Avoid" },
    { key: "cur_secret", label: "Curiosity: what nobody tells you", brief: "A little-known tip that makes a visible difference; specific, not clickbait.", demo: "{Idea}: What Nobody Tells You" },
    { key: "cur_myth", label: "Curiosity: myth vs fact", brief: "Busts one popular myth with a clear, accurate fact.", demo: "{Idea}: Myth vs Fact" },
    { key: "cur_checklist", label: "Curiosity: checklist", brief: "A save-worthy checklist (how-to style) the viewer can follow step by step.", demo: "The {Idea} Checklist" },
    { key: "cur_oneChange", label: "Curiosity: the one change", brief: "One simple change with a big result, framed as inspiration.", demo: "One Small Change: {Idea}" },
  ],
};

/** The five angles for a pin set. */
export function anglesFor(style: PinStyle | undefined): readonly { key: string; label: string; brief: string; demo?: string }[] {
  return !style || style === "mixed" ? PIN_ANGLES : STYLE_ANGLES[style];
}

/** Position (0-4) of an angle label within its set, used to give each pin its own layout. */
export function anglePosition(label: string | undefined): number | null {
  if (!label) return null;
  for (const set of [PIN_ANGLES, ...Object.values(STYLE_ANGLES)]) {
    const i = (set as readonly { label: string }[]).findIndex((a) => a.label === label);
    if (i >= 0) return i;
  }
  return null;
}
