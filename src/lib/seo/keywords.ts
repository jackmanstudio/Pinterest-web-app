import { detectEvents, seasonTiming, SEASON_EVENTS, type SeasonEvent } from "./seasonality";

/**
 * Keyword research for one pin idea, built before the AI writes the copy.
 *
 * Sources, in order of trust:
 * 1. trending: rising searches from the account's own Pinterest Trends snapshot (live data).
 * 2. seasonal: yearly moments people are planning for right now (built-in calendar, updates by date).
 * 3. longTail: autocomplete-style phrases made from the idea's own modifiers and the niche's common search modifiers.
 * 4. related: a curated list of evergreen, high-volume Pinterest searches for the niche.
 *
 * Everything except "trending" is curated, not live data. The prompt tells the
 * AI to use a phrase only when it is true for the pin, so nothing is stuffed in.
 */
/** Generic hooks that could sit on any pin. The prompt bans them and the quality check flags them. */
export const GENERIC_PHRASES = [
  "save and try", "worth saving", "worth trying", "ideas worth saving", "save this for later", "tips and tricks", "everything you need to know",
  "you'll love", "you will love", "you need to try", "must try", "to inspire you", "for every occasion", "for everyone", "simple ideas",
  "easy ideas", "great ideas", "best ideas", "amazing ideas", "inspiration and ideas", "without the guesswork", "everyday inspiration",
];

export interface KeywordPlan {
  /** The main search phrase, e.g. "small living room decor". Goes at the front of the title. */
  primary: string;
  niche: string | null;
  longTail: string[];
  related: string[];
  seasonal: string[];
  trending: string[];
  /** Brand focus keywords that fit this idea. */
  focus: string[];
}

export interface KeywordPlanInput {
  idea: string;
  category?: string;
  trendKeywords?: string[];
  focusKeywords?: string[];
  today?: Date;
}

interface Niche {
  id: string;
  /** Words in the idea or category that point to this niche. */
  words: string[];
  /** Evergreen searches people type on Pinterest in this niche. */
  related: string[];
  /** Common autocomplete endings for the niche ("… for women", "… on a budget"). */
  modifiers: string[];
}

const NICHES: Niche[] = [
  {
    id: "modest fashion",
    words: ["modest", "hijab", "abaya", "eid", "kaftan", "shalwar", "kameez", "dupatta", "kurta", "kurti", "lawn", "desi", "pakistani"],
    related: ["modest outfits", "hijab outfits", "abaya styles", "eid outfits", "pakistani dresses", "desi outfits", "kurti designs", "modest fashion"],
    modifiers: ["for women", "casual", "for eid", "for weddings", "simple", "elegant", "for summer", "for winter"],
  },
  {
    id: "fashion",
    words: ["outfit", "outfits", "fashion", "style", "styling", "wardrobe", "capsule", "dress", "dresses", "coat", "trench", "jacket", "jeans", "sweater", "knit", "blazer", "skirt", "shoes", "boots", "sneakers", "bag", "handbag", "look", "looks", "wear", "ootd", "menswear"],
    related: ["outfit ideas", "casual outfits", "fall outfits", "winter outfits", "work outfits", "capsule wardrobe", "old money style", "classy outfits", "street style", "outfit inspo"],
    modifiers: ["for women", "for men", "casual", "aesthetic", "classy", "for work", "for fall", "for winter", "for summer", "2027"],
  },
  {
    id: "beauty",
    words: ["makeup", "lipstick", "eyeliner", "eyeshadow", "skincare", "skin", "serum", "hair", "hairstyle", "hairstyles", "braids", "curls", "nails", "nail", "manicure", "perfume", "fragrance", "glow"],
    related: ["makeup looks", "natural makeup", "skincare routine", "glowing skin", "easy hairstyles", "nail ideas", "nail art designs", "hair care tips"],
    modifiers: ["for beginners", "natural", "easy", "for brown skin", "for dry skin", "step by step", "aesthetic", "at home"],
  },
  {
    id: "home",
    words: ["decor", "living room", "bedroom", "kitchen", "bathroom", "interior", "home", "room", "furniture", "sofa", "shelf", "wall", "apartment", "organization", "organize", "declutter", "storage", "pantry", "closet", "diy", "renovation", "makeover"],
    related: ["home decor ideas", "living room ideas", "bedroom ideas", "cozy home", "small space ideas", "home organization", "apartment decor", "kitchen ideas", "diy home decor"],
    modifiers: ["on a budget", "for small spaces", "modern", "cozy", "aesthetic", "minimalist", "diy", "for renters"],
  },
  {
    id: "food",
    words: ["recipe", "recipes", "cooking", "dinner", "lunch", "breakfast", "chicken", "pasta", "curry", "soup", "meal", "meals", "baking", "bake", "cake", "cookies", "dessert", "desserts", "bread", "snack", "snacks", "smoothie", "salad", "biryani"],
    related: ["easy dinner recipes", "healthy recipes", "meal prep", "quick meals", "dinner ideas", "dessert recipes", "easy baking recipes", "comfort food"],
    modifiers: ["easy", "healthy", "quick", "for beginners", "for two", "for a crowd", "high protein", "30 minute", "vegetarian", "one pot"],
  },
  {
    id: "weddings",
    words: ["wedding", "weddings", "bride", "bridal", "bridesmaid", "mehndi", "engagement", "nikah", "baraat", "walima", "party", "birthday", "celebration"],
    related: ["wedding ideas", "wedding decor", "bridal looks", "wedding guest outfits", "mehndi decor", "party ideas", "birthday party ideas", "wedding inspiration"],
    modifiers: ["on a budget", "elegant", "simple", "diy", "outdoor", "small", "for summer", "for winter"],
  },
  {
    id: "travel",
    words: ["travel", "trip", "destination", "destinations", "vacation", "itinerary", "beach", "hotel", "packing", "holiday"],
    related: ["travel tips", "travel destinations", "packing list", "travel itinerary", "bucket list travel", "weekend getaway", "travel outfits"],
    modifiers: ["on a budget", "for beginners", "with kids", "for couples", "solo", "in winter", "in summer", "checklist"],
  },
  {
    id: "fitness & wellness",
    words: ["fitness", "workout", "exercise", "gym", "yoga", "pilates", "running", "abs", "strength", "weight loss", "healthy", "nutrition", "protein", "sleep", "self care", "self-care", "wellness", "mindfulness", "meditation", "journaling", "mental health", "routine"],
    related: ["workout plan", "home workout", "healthy habits", "self care ideas", "morning routine", "wellness tips", "yoga for beginners", "healthy lifestyle"],
    modifiers: ["for beginners", "at home", "for women", "no equipment", "daily", "easy", "15 minute", "printable"],
  },
  {
    id: "parenting",
    words: ["parenting", "parent", "mom", "dad", "baby", "newborn", "toddler", "kids", "pregnancy", "nursery", "children"],
    related: ["parenting tips", "toddler activities", "baby essentials", "kids activities", "nursery ideas", "mom hacks"],
    modifiers: ["for toddlers", "at home", "easy", "for new moms", "indoor", "printable", "by age"],
  },
  {
    id: "garden & pets",
    words: ["garden", "gardening", "plants", "plant", "flowers", "succulents", "houseplants", "pet", "pets", "dog", "dogs", "cat", "cats", "puppy"],
    related: ["gardening for beginners", "indoor plants", "garden ideas", "plant care tips", "dog care tips", "cat care", "pet hacks"],
    modifiers: ["for beginners", "indoor", "low maintenance", "small", "easy", "diy"],
  },
  {
    id: "business & marketing",
    words: ["business", "entrepreneur", "startup", "side hustle", "income", "ecommerce", "etsy", "freelance", "marketing", "social media", "instagram", "pinterest", "seo", "content", "blog", "blogging", "email", "branding", "productivity", "planner", "printable", "template", "canva", "digital products"],
    related: ["side hustle ideas", "small business tips", "social media marketing", "content ideas", "pinterest marketing", "blogging tips", "productivity tips", "digital products to sell"],
    modifiers: ["for beginners", "for small business", "from home", "step by step", "free", "checklist", "2027", "ideas"],
  },
  {
    id: "tech",
    words: ["tech", "technology", "gadgets", "gadget", "phone", "laptop", "ai", "apps", "app", "smart home", "iphone", "android"],
    related: ["tech gadgets", "iphone tips", "useful apps", "desk setup", "ai tools", "smart home ideas"],
    modifiers: ["for students", "for work", "under $50", "for beginners", "hidden"],
  },
];

/** Words that add nothing to a search phrase at its start or end. */
const LEAD = /^(?:\d+\s+|the\s+|best\s+|top\s+|my\s+|our\s+|how\s+to\s+|ways\s+to\s+|easy\s+ways\s+to\s+)+/i;
const TRAIL = /\s+(?:ideas?|tips|guide|inspiration|inspo|tutorial|hacks)$/i;
/** Where a modifier starts: "small living room decor | on a budget". */
const SPLIT = /\s+(?=(?:on a|for|with|without|under|in|at|that|this|from|to)\s)/i;
const STOP = new Set(["the", "and", "for", "with", "your", "you", "this", "that", "are", "from", "into", "how", "what", "a", "an", "to", "of", "in", "on", "is", "at", "by", "or", "ideas", "idea", "tips", "best", "easy"]);

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'$\s-]/gu, " ").replace(/\s+/g, " ").trim();
const contentWords = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const mentions = (text: string, phrase: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(norm(phrase))}([^\\p{L}\\p{N}]|$)`, "u").test(norm(text));
const stem = (w: string) => w.replace(/(ies|es|s)$/, "");
const overlaps = (a: string, b: string) => {
  const bw = new Set(contentWords(b).map(stem));
  return contentWords(a).some((w) => bw.has(stem(w)));
};

/** "7 small living room decor ideas on a budget" → { head: "small living room decor", tail: "on a budget" } */
export function splitIdea(idea: string): { head: string; tail: string } {
  const n = norm(idea).replace(LEAD, "");
  const [head, ...rest] = n.split(SPLIT);
  const h = head.replace(TRAIL, "").trim() || head.trim();
  return { head: h.split(" ").slice(0, 6).join(" "), tail: rest.join(" ").trim() };
}

export function detectNiche(text: string): Niche | null {
  const t = norm(text);
  let best: { n: Niche; score: number } | null = null;
  for (const n of NICHES) {
    const score = n.words.filter((w) => mentions(t, w)).length;
    if (score && (!best || score > best.score)) best = { n, score };
  }
  return best?.n ?? null;
}

/** Occasions with their own meaning: never mix another holiday into them ("christmas eid outfit"). */
const OCCASIONS = ["eid", "ramadan", "ramzan", "diwali", "holi", "wedding", "bridal", "mehndi", "nikah", "birthday", "baby shower", "graduation", "anniversary"];

/** "christmas small living room decor": the search people make for an upcoming moment. */
function eventPhrase(e: SeasonEvent, head: string): string | null {
  const word = e.words[0];
  if (!head || mentions(head, word) || VERB_LED.test(head)) return null;
  return `${word} ${head}`;
}

const VERB_LED = /^(\S+ing|how|why|what)\b/;
/** Holidays that are real searches in a niche ("christmas outfits", not "black friday meal prep"). */
const EVENT_NICHES: Record<string, string[]> = {
  "black-friday": ["fashion", "beauty", "tech"],
  "valentines": ["fashion", "beauty", "home", "food", "weddings"],
  "mothers-day": ["fashion", "beauty", "home", "food"],
  "fathers-day": ["fashion", "tech", "food"],
};
const SEASONAL_NICHES = new Set(["fashion", "modest fashion", "beauty", "home", "food", "weddings", "travel", "parenting"]);

/** Modifiers that read naturally in front ("cozy small living room decor"), not after. */
const FRONT = new Set(["modern", "cozy", "aesthetic", "minimalist", "diy", "casual", "classy", "elegant", "simple", "easy", "healthy", "quick", "natural", "vegetarian", "high protein", "30 minute", "15 minute", "one pot", "solo", "outdoor", "small", "indoor", "low maintenance", "daily", "free", "hidden", "2027", "printable"]);

const uniq = (xs: string[], skip: string[] = []) => {
  const seen = new Set(skip.map(norm));
  return xs.map(norm).filter((x) => x && x.split(" ").length <= 8 && !seen.has(x) && (seen.add(x), true));
};

export function buildKeywordPlan(input: KeywordPlanInput): KeywordPlan {
  const { head, tail } = splitIdea(input.idea);
  const primary = head;
  const text = `${input.idea} ${input.category ?? ""}`;
  const niche = detectNiche(text);
  const now = input.today ?? new Date();

  // Long tail: the idea's own modifier first (it is true by definition), then the niche's
  // common autocomplete endings that the idea doesn't contradict.
  const ideaTail = tail ? [`${primary} ${tail}`] : [];
  const nicheTails = (niche?.modifiers ?? [])
    .filter((m) => !mentions(input.idea, m))
    .filter((m) => !/\b(spring|summer|fall|autumn|winter)\b/.test(m) || detectEvents(input.idea).length === 0 || mentions(input.idea, m.replace(/^(for|in)\s+/, "")))
    .filter((m) => !contentWords(m).some((w) => contentWords(primary).map(stem).includes(stem(w))))
    .filter((m) => !(FRONT.has(m) && VERB_LED.test(primary)))
    .slice(0, 5)
    .map((m) => (FRONT.has(m) ? `${m} ${primary}` : `${primary} ${m}`));
  // "cozy winter outfits" → "cozy winter outfit ideas"
  const ideasPhrase = `${primary.replace(/([^s])s$/, "$1")} ideas`;
  const longTail = uniq([...ideaTail, ideasPhrase, ...nicheTails], [primary]).slice(0, 6);

  // Related evergreen searches: ones that share a word with the idea first.
  const pool = niche?.related ?? [];
  const samePhrase = (r: string) => contentWords(r).map(stem).join(" ") === contentWords(primary).map(stem).join(" ");
  const related = uniq([...pool.filter((r) => overlaps(r, input.idea)), ...pool.filter((r) => !overlaps(r, input.idea))].filter((r) => !samePhrase(r)), [primary, ...longTail]).slice(0, 6);

  // Seasonal: the idea's own moment, or what people are planning for in the next weeks.
  const own = detectEvents(input.idea);
  const hasOccasion = OCCASIONS.some((o) => mentions(input.idea, o));
  const upcoming = own.length
    ? own
    : hasOccasion
      ? []
      : SEASON_EVENTS.filter(
          (e) =>
            niche && SEASONAL_NICHES.has(niche.id) && (EVENT_NICHES[e.id] ?? [...SEASONAL_NICHES]).includes(niche.id) && ["ahead", "peak"].includes(seasonTiming(e.words[0], now).status),
        ).slice(0, 3);
  const seasonal = uniq(upcoming.map((e) => eventPhrase(e, primary)).filter((x): x is string => Boolean(x)), [primary]).slice(0, 3);

  // Live trends: only those related to this idea or its niche.
  const nicheWords = [...(niche?.words ?? []), ...(niche?.related ?? [])].join(" ");
  const trends = (input.trendKeywords ?? []).filter(Boolean);
  const trending = uniq([...trends.filter((k) => overlaps(k, input.idea)), ...trends.filter((k) => !overlaps(k, input.idea) && overlaps(k, nicheWords)).slice(0, 2)], [primary]).slice(0, 5);

  const focus = uniq((input.focusKeywords ?? []).filter((k) => overlaps(k, text) || overlaps(k, nicheWords))).slice(0, 4);

  return { primary, niche: niche?.id ?? null, longTail, related, seasonal, trending, focus };
}

/** The keyword brief that goes into the AI prompt. */
export function keywordBrief(plan: KeywordPlan, opts: { language?: string; ideaIsSeasonal?: boolean } = {}): string {
  const native = opts.language && !/^english$/i.test(opts.language) ? opts.language : "";
  const line = (label: string, xs: string[]) => (xs.length ? `- ${label}: ${xs.join("; ")}` : "");
  return [
    `Keyword research for this idea${native ? ` (English research: write the ${native} phrases people would actually search for with the same meaning; keep brand names as they are)` : ""}:`,
    `- Primary keyword (must lead the title, appear in the first sentence of the description, in the alt text and as the first tag): ${plan.primary}`,
    line("Live rising Pinterest searches (strongest signal; use one or two where they truly fit)", plan.trending),
    line("Long-tail searches (autocomplete-style; use only the ones that are true for this pin)", plan.longTail),
    line("Related searches in this niche (good for tags and the description)", plan.related),
    line(
      opts.ideaIsSeasonal ? "Seasonal searches for this moment" : "Timely searches people are planning for now (tags or description only, and only if the pin genuinely fits; never put them in the title)",
      plan.seasonal,
    ),
    line("Brand focus keywords that fit", plan.focus),
    "Keyword rules: every draft uses the primary keyword; each draft picks a DIFFERENT 2-4 secondary phrases from the lists above so the five pins rank for different searches; weave them into normal sentences; never list keywords, never repeat a phrase more than twice in a pin, and never use a phrase that isn't true for that pin.",
  ]
    .filter(Boolean)
    .join("\n");
}
