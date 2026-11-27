import { describe, expect, it } from "vitest";
import { buildKeywordPlan, keywordBrief, splitIdea } from "@/lib/seo/keywords";
import { polishSeo } from "@/lib/seo/polish";
import { draftsUserPrompt, DRAFTS_SYSTEM } from "@/lib/ai/text/prompt";
import { reviewDraft } from "@/lib/drafts/quality";
import { ensureSeoTitle } from "@/lib/drafts/tidyTitle";

const NOV = new Date("2026-11-27T12:00:00Z");
const brand = { brand_name: "", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] };

describe("keyword research", () => {
  it("finds the primary keyword and the idea's own long tail", () => {
    expect(splitIdea("7 small living room decor ideas on a budget")).toEqual({ head: "small living room decor", tail: "on a budget" });
    const p = buildKeywordPlan({ idea: "Small living room decor ideas on a budget", today: NOV });
    expect(p.primary).toBe("small living room decor");
    expect(p.niche).toBe("home");
    expect(p.longTail[0]).toBe("small living room decor on a budget");
    expect(p.longTail).toContain("cozy small living room decor");
    expect(p.related).toContain("living room ideas");
    expect(p.seasonal).toContain("christmas small living room decor");
  });

  it("keeps live trends that relate to the idea first, and drops unrelated ones", () => {
    const p = buildKeywordPlan({ idea: "Cozy winter outfits for work", today: NOV, trendKeywords: ["winter work outfits", "christmas outfits", "air fryer recipes"] });
    expect(p.trending[0]).toBe("winter work outfits");
    expect(p.trending).not.toContain("air fryer recipes");
  });

  it("never mixes another holiday into an occasion like Eid", () => {
    const p = buildKeywordPlan({ idea: "Eid outfit ideas for women", today: NOV });
    expect(p.seasonal).toEqual([]);
    expect(p.longTail).not.toContain("eid outfit for eid");
    expect(p.related).not.toContain("eid outfits");
  });

  it("asks for native phrases when the pin is in Urdu", () => {
    const brief = keywordBrief(buildKeywordPlan({ idea: "Eid outfit ideas", today: NOV }), { language: "Urdu" });
    expect(brief).toMatch(/Urdu phrases people would actually search/);
    expect(brief).toMatch(/Primary keyword .*: eid outfit/);
  });

  it("puts the research and the anti-generic rules in the AI prompt", () => {
    const prompt = draftsUserPrompt({ workspace: "fashion", idea: "Trench coat outfits for rainy days", brand, trend_keywords: ["trench coat outfit"] });
    expect(prompt).toMatch(/Primary keyword/);
    expect(prompt).toMatch(/Live rising Pinterest searches.*trench coat outfit/);
    expect(DRAFTS_SYSTEM).toMatch(/No generic copy/);
    expect(DRAFTS_SYSTEM).toMatch(/save and try/);
  });
});

describe("SEO polish after the AI", () => {
  const d = { title: "Small Living Room Decor: 7 Rental-Friendly Swaps", description: "Small living room decor that works for renters. #decor Save these swaps.", tags: ["#Living Room", "living room", "rental decor"], alt_text: "Image of a small living room with a green velvet sofa" };
  it("cleans tags, leads with the primary keyword and tops up to five", () => {
    const [out] = polishSeo([d], { idea: "Small living room decor ideas on a budget", today: NOV });
    expect(out.tags[0]).toBe("small living room decor");
    expect(out.tags).toContain("living room");
    expect(out.tags.length).toBeGreaterThanOrEqual(5);
    expect(new Set(out.tags).size).toBe(out.tags.length);
    expect(out.alt_text).toBe("A small living room with a green velvet sofa");
    expect(out.description).not.toMatch(/#/);
  });
  it("leaves Urdu tags in Urdu", () => {
    const ur = { ...d, tags: ["عید کے کپڑے"] };
    expect(polishSeo([ur], { idea: "Eid outfits", language: "Urdu" })[0].tags).toEqual(["عید کے کپڑے"]);
  });
});

describe("no generic titles or descriptions", () => {
  it("lengthens short titles with the idea's own words, not filler", () => {
    const t = ensureSeoTitle("Meal Prep: fast dinners", "Easy meal prep for busy weeknights");
    expect(t).not.toMatch(/save and try|worth saving/i);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });
  it("flags generic wording and a buried keyword", () => {
    const r = reviewDraft(
      { angle: "", concept: "", image_prompt: "", title: "So Many Lovely Weekend Looks and Small Living Room Decor", description: "Small living room decor ideas worth saving. You'll love these for every occasion, so save and try them today please.", tags: ["a", "b", "c"], alt_text: "A small living room with a sofa and plants by the window" },
      { idea: "Small living room decor" },
    );
    expect(r.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["generic", "title-front"]));
  });
});
