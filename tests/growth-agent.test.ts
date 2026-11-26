import { describe, expect, it } from "vitest";
import { GrowthIdeasSchema, growthUserPrompt, ruleGrowthIdeas, verifyGrowthIdeas, type GrowthIdea, type GrowthInput } from "@/lib/agents/growth";

const input = (over: Partial<GrowthInput> = {}): GrowthInput => ({
  workspace: "fashion",
  brand: { brand_name: "Studio", audience: null, focus_keywords: ["linen"], banned_words: ["cheap"], language: null },
  account: { IMPRESSION: 12840, SAVE: 312 },
  pins: [
    { pin_id: "p1", title: "Linen summer outfits", saves: 120, clicks: 40, outbound: 18 },
    { pin_id: "p2", title: "Capsule wardrobe basics", saves: 30, clicks: 9, outbound: 2 },
  ],
  trends: [
    { keyword: "linen trousers", pct_growth_wow: 45, pct_growth_mom: null, pct_growth_yoy: null },
    { keyword: "gym bags", pct_growth_wow: 80, pct_growth_mom: null, pct_growth_yoy: null },
  ],
  recent: ["Summer capsule wardrobe for travel"],
  want: 5,
  ...over,
});

const idea = (over: Partial<GrowthIdea>): GrowthIdea => ({ idea: "Linen work outfits for hot offices", reason: "Your linen pin leads saves.", evidence: "Pin p1: 120 saves", signal: "top_pin", ref: "p1", ...over });

describe("growth agent checks", () => {
  it("keeps grounded ideas", () => {
    const { kept, dropped } = verifyGrowthIdeas([idea({})], input());
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("drops invented numbers, unknown pins and unknown trends", () => {
    const { kept, dropped } = verifyGrowthIdeas(
      [
        idea({ evidence: "Pin p1: 999 saves" }),
        idea({ idea: "Linen bags for the beach", ref: "nope" }),
        idea({ idea: "Mesh tote ideas", signal: "trend", ref: "mesh totes" }),
      ],
      input(),
    );
    expect(kept).toHaveLength(0);
    expect(dropped.map((d) => d.why)).toEqual(["quotes a number not in the data", "unknown pin", "unknown trend"]);
  });

  it("drops banned words, repeats of recent ideas and duplicates within a run", () => {
    const { kept, dropped } = verifyGrowthIdeas(
      [
        idea({ idea: "Cheap linen outfits" }),
        idea({ idea: "Summer capsule wardrobe for travel!", signal: "gap", ref: null }),
        idea({}),
        idea({}),
      ],
      input(),
    );
    expect(kept).toHaveLength(1);
    expect(dropped.map((d) => d.why)).toEqual(["uses a banned word", "repeats a recent idea", "repeats a recent idea"]);
  });

  it("respects the per-run limit", () => {
    const many = ["a linen dress idea", "b work bag guide", "c desk plants list"].map((t) => idea({ idea: t, signal: "gap", ref: null, evidence: "" }));
    expect(verifyGrowthIdeas(many, input({ want: 2 })).kept).toHaveLength(2);
  });

  it("matches trend refs case-insensitively", () => {
    expect(verifyGrowthIdeas([idea({ idea: "Wide linen trousers styling", signal: "trend", ref: "Linen Trousers", evidence: "45% growth" })], input()).kept).toHaveLength(1);
  });
});

describe("rule-based fallback", () => {
  it("suggests remakes of winners and focus-relevant trends, all passing checks", () => {
    const inp = input();
    const ideas = ruleGrowthIdeas(inp);
    expect(ideas.some((i) => i.signal === "top_pin" && i.ref === "p1")).toBe(true);
    expect(ideas.some((i) => i.signal === "trend" && i.ref === "linen trousers")).toBe(true);
    expect(ideas.some((i) => i.ref === "gym bags")).toBe(false);
    expect(verifyGrowthIdeas(ideas, inp).kept.length).toBe(ideas.length);
    expect(GrowthIdeasSchema.safeParse({ ideas }).success).toBe(true);
  });

  it("returns nothing with no data", () => {
    expect(ruleGrowthIdeas(input({ pins: [], trends: [] }))).toEqual([]);
  });
});

describe("prompt", () => {
  it("includes the data and the limit", () => {
    const p = growthUserPrompt(input({ want: 3 }));
    expect(p).toContain("up to 3 ideas");
    expect(p).toContain("linen trousers");
  });
});
