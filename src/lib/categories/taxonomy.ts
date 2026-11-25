import type { Category, WorkspaceKind } from "@/lib/types";

/**
 * The 40-category taxonomy from the product spec (section 6).
 * Macro starts with all 40; Fashion starts with the first ten.
 * Keep this list in sync with public.default_category_names() in migration 0008.
 */
export const TAXONOMY_40 = [
  "Women's Fashion",
  "Men's Fashion",
  "Kids & Baby Fashion",
  "Modest Fashion",
  "Streetwear & Urban Style",
  "Luxury & Designer Fashion",
  "Shoes & Footwear",
  "Bags & Handbags",
  "Jewelry & Watches",
  "Fashion Trends & Outfit Inspiration",
  "Makeup",
  "Skincare",
  "Haircare & Hairstyles",
  "Nails & Nail Art",
  "Fragrance & Perfumes",
  "Interior Design",
  "Home Decor",
  "Architecture",
  "Real Estate & Property",
  "Home Organization",
  "DIY & Home Improvement",
  "Recipes & Cooking",
  "Baking & Desserts",
  "Parenting & Baby Care",
  "Weddings & Celebrations",
  "Travel & Destinations",
  "Fitness & Exercise",
  "Gardening & Plants",
  "Pets & Animals",
  "Photography & Videography",
  "Entrepreneurship & Online Business",
  "Digital Marketing & Social Media",
  "Technology & Gadgets",
  "Graphic Design & Digital Products",
  "Personal Development & Productivity",
  "Mental Health & Mindfulness",
  "Healthy Eating & Nutrition",
  "Weight Loss & Body Wellness",
  "Sleep & Recovery",
  "Self-Care & Daily Wellness",
] as const;

export function defaultCategories(kind: WorkspaceKind): string[] {
  return kind === "macro" ? [...TAXONOMY_40] : TAXONOMY_40.slice(0, 10);
}

/** Extra words that point to each spec category (the name's own words count too). */
const HINTS: Record<string, string[]> = {
  "Women's Fashion": ["women", "womens", "woman", "ladies", "dress", "dresses", "skirt", "blouse", "trench", "coat", "cardigan", "abaya"],
  "Men's Fashion": ["men", "mens", "man", "menswear", "suit", "blazer", "beard", "gentleman", "shirt"],
  "Kids & Baby Fashion": ["kids", "kid", "baby", "toddler", "children", "girls", "boys"],
  "Modest Fashion": ["modest", "hijab", "abaya", "covered", "eid", "kaftan"],
  "Streetwear & Urban Style": ["streetwear", "street", "urban", "sneakerhead", "hoodie", "oversized", "cargo"],
  "Luxury & Designer Fashion": ["luxury", "designer", "couture", "chanel", "dior", "gucci", "quiet", "old money"],
  "Shoes & Footwear": ["shoes", "shoe", "sneakers", "boots", "heels", "sandals", "loafers", "footwear"],
  "Bags & Handbags": ["bag", "bags", "handbag", "handbags", "tote", "clutch", "purse", "backpack"],
  "Jewelry & Watches": ["jewelry", "jewellery", "necklace", "earrings", "ring", "rings", "bracelet", "watch", "watches", "gold"],
  "Fashion Trends & Outfit Inspiration": ["outfit", "outfits", "trend", "trends", "style", "styling", "look", "looks", "wardrobe", "capsule", "ootd", "layering", "fall", "autumn", "winter", "summer", "spring"],
  Makeup: ["makeup", "lipstick", "eyeliner", "eyeshadow", "foundation", "blush", "contour", "mascara"],
  Skincare: ["skincare", "skin", "serum", "moisturizer", "acne", "sunscreen", "spf", "glow", "retinol"],
  "Haircare & Hairstyles": ["hair", "hairstyle", "hairstyles", "braids", "curls", "haircut", "bun", "ponytail"],
  "Nails & Nail Art": ["nail", "nails", "manicure", "gel", "polish"],
  "Fragrance & Perfumes": ["perfume", "perfumes", "fragrance", "scent", "cologne", "oud"],
  "Interior Design": ["interior", "living room", "bedroom", "kitchen", "bathroom", "furniture", "sofa"],
  "Home Decor": ["decor", "decoration", "wall", "shelf", "cozy", "candles", "rug", "aesthetic room"],
  Architecture: ["architecture", "building", "facade", "modernist", "villa"],
  "Real Estate & Property": ["real estate", "property", "mortgage", "house hunting", "rent", "buying a home", "realtor"],
  "Home Organization": ["organization", "organize", "organizing", "declutter", "storage", "pantry", "closet"],
  "DIY & Home Improvement": ["diy", "renovation", "paint", "improvement", "makeover", "build"],
  "Recipes & Cooking": ["recipe", "recipes", "cooking", "dinner", "lunch", "breakfast", "chicken", "pasta", "curry", "soup", "meal"],
  "Baking & Desserts": ["baking", "bake", "cake", "cookies", "dessert", "desserts", "bread", "brownies", "cupcakes"],
  "Parenting & Baby Care": ["parenting", "parent", "mom", "dad", "newborn", "toddler", "pregnancy", "nursery"],
  "Weddings & Celebrations": ["wedding", "weddings", "bride", "bridal", "party", "birthday", "celebration", "mehndi", "engagement"],
  "Travel & Destinations": ["travel", "trip", "destination", "destinations", "vacation", "itinerary", "beach", "hotel", "packing"],
  "Fitness & Exercise": ["fitness", "workout", "exercise", "gym", "yoga", "pilates", "running", "abs", "strength"],
  "Gardening & Plants": ["garden", "gardening", "plants", "plant", "flowers", "succulents", "houseplants", "seeds"],
  "Pets & Animals": ["pet", "pets", "dog", "dogs", "cat", "cats", "puppy", "kitten", "animals"],
  "Photography & Videography": ["photography", "photo", "photos", "camera", "video", "videography", "editing", "lightroom"],
  "Entrepreneurship & Online Business": ["business", "entrepreneur", "startup", "side hustle", "income", "ecommerce", "etsy", "freelance"],
  "Digital Marketing & Social Media": ["marketing", "social media", "instagram", "pinterest", "seo", "tiktok", "content", "email list", "followers"],
  "Technology & Gadgets": ["tech", "technology", "gadgets", "gadget", "phone", "laptop", "ai", "apps", "smart home"],
  "Graphic Design & Digital Products": ["graphic design", "canva", "printable", "printables", "template", "templates", "digital products", "logo", "font"],
  "Personal Development & Productivity": ["productivity", "habits", "goals", "planner", "motivation", "routine", "time management", "self improvement"],
  "Mental Health & Mindfulness": ["mental health", "mindfulness", "anxiety", "stress", "meditation", "journaling", "calm"],
  "Healthy Eating & Nutrition": ["healthy", "nutrition", "protein", "salad", "smoothie", "vegan", "meal prep", "vitamins"],
  "Weight Loss & Body Wellness": ["weight loss", "lose weight", "fat", "calories", "body", "slim"],
  "Sleep & Recovery": ["sleep", "insomnia", "bedtime", "recovery", "rest", "nap"],
  "Self-Care & Daily Wellness": ["self care", "self-care", "wellness", "pamper", "morning routine", "night routine", "bath"],
};

/**
 * Hints by the words a category's own name uses, so renamed or custom
 * categories ("Seasonal trends", "Styling tips", "Outfit ideas") still match.
 */
const CONCEPTS: [RegExp, string[]][] = [
  [/season|holiday|festive/, ["autumn", "fall", "winter", "summer", "spring", "christmas", "holiday", "eid", "ramadan", "halloween", "thanksgiving", "valentine", "easter", "back to school", "new year", "seasonal"]],
  [/styl|how to wear|wear/, ["styling", "style", "layering", "layer", "how to wear", "wear", "pair", "pairing", "combine", "styled", "tips"]],
  [/outfit|look|ootd|wardrobe/, ["outfit", "look", "ootd", "wardrobe", "capsule", "dress", "coat", "trench", "jacket", "jeans", "sweater", "knit", "blazer", "skirt", "boots", "shirt"]],
  [/trend/, ["trend", "trending", "this season", "viral", "aesthetic"]],
  [/accessor/, ["bag", "belt", "scarf", "hat", "jewelry", "jewellery", "sunglasses", "watch", "earrings"]],
  [/beauty|makeup/, ["makeup", "lipstick", "skincare", "glow", "nails", "hair"]],
  [/home|decor|interior/, ["decor", "living room", "bedroom", "cozy", "kitchen", "shelf"]],
  [/food|recipe|cook/, ["recipe", "dinner", "lunch", "breakfast", "meal"]],
  [/travel/, ["trip", "travel", "vacation", "packing", "itinerary", "destination"]],
  [/gift/, ["gift", "gifts", "present", "presents", "gift guide"]],
];

function conceptHints(name: string): string[] {
  const n = name.toLowerCase();
  return CONCEPTS.filter(([re]) => re.test(n)).flatMap(([, words]) => words);
}

const STOP = new Set(["and", "the", "for", "with", "your", "you", "how", "to", "of", "in", "on", "a", "an", "ideas", "tips", "s"]);

function norm(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function nameWords(name: string): string[] {
  return norm(name).trim().split(" ").filter((w) => w.length > 2 && !STOP.has(w));
}

export interface DetectedCategory {
  category: Category;
  score: number;
  matched: string[];
}

/**
 * Picks the best category from the workspace's own list for a title or idea.
 * Matches the category's name words, its sub-category names and the spec hint
 * words. Returns null when nothing matches, so the UI can say so honestly.
 */
export function detectCategory(text: string, categories: Category[]): DetectedCategory | null {
  const t = norm(text);
  let best: DetectedCategory | null = null;
  for (const c of categories) {
    const strong = new Set([...nameWords(c.name), ...(HINTS[c.name] ?? []).map((h) => h.toLowerCase())]);
    // Concept words are weaker than the category's own name and hint words.
    const words = new Set([...strong, ...conceptHints(c.name)]);
    const matched: string[] = [];
    let score = 0;
    for (const w of words) {
      // "trend" also matches "trends", and "outfits" also matches "outfit".
      const forms = [w, w.endsWith("s") ? w.slice(0, -1) : `${w}s`];
      if (forms.some((f) => f.length > 2 && t.includes(` ${f} `))) {
        matched.push(w);
        score += (w.includes(" ") ? 3 : 2) - (strong.has(w) ? 0 : 1);
      }
    }
    // A sub-category's own name is a strong, specific signal.
    if (c.parent_id && t.includes(norm(c.name))) score += 4;
    if (score > 0 && (!best || score > best.score || (score === best.score && c.parent_id && !best.category.parent_id))) {
      best = { category: c, score, matched };
    }
  }
  return best;
}
