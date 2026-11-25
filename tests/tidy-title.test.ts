import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/lib/drafts/tidyTitle";

describe("tidyTitle", () => {
  it("fixes the QA examples", () => {
    expect(tidyTitle("7 Cozy Winter Outfit Ideas Ideas Worth Saving")).toBe("7 Cozy Winter Outfit Ideas Worth Saving");
    expect(tidyTitle("Layering A Trench Coat For Autumn for Autumn", "Layering a trench coat for autumn")).toBe("Layering a Trench Coat for Autumn");
    expect(tidyTitle("Summer Linen Outfits for Autumn", "Summer linen outfits")).toBe("Summer Linen Outfits");
    expect(tidyTitle("Stuck in a Rut? Cozy Winter Outfit Ideas Is the Easy Fix")).toBe("Stuck in a Rut? Cozy Winter Outfit Ideas Are the Easy Fix");
  });
  it("leaves good titles and other languages alone", () => {
    expect(tidyTitle("This Dress Is the One: Easy Eid Looks")).toBe("This Dress Is the One: Easy Eid Looks");
    expect(tidyTitle("Trench coat: layer like a pro")).toBe("Trench coat: layer like a pro");
    expect(tidyTitle("عید کے لیے خوبصورت لباس")).toBe("عید کے لیے خوبصورت لباس");
    expect(tidyTitle("Fall Outfits: the Fall Edit", "fall outfits")).toBe("Fall Outfits: The Fall Edit".replace("The", "the"));
  });
});

describe("title keyword check", async () => {
  const { reviewDraft } = await import("@/lib/drafts/quality");
  const base = { angle: "", concept: "", image_prompt: "", description: "x".repeat(160) + ".", tags: ["a", "b", "c"], alt_text: "A cosy small living room with a green sofa and plants." };
  it("warns when the title misses the idea's main keyword", () => {
    const idea = "Small living room decor ideas on a budget";
    expect(reviewDraft({ ...base, title: "Budget Decor: 5 ideas" }, { idea }).checks.map((c) => c.id)).toEqual(expect.arrayContaining(["title-keyword", "title-short"]));
    expect(reviewDraft({ ...base, title: "Small Living Room Decor: 5 budget ideas that work" }, { idea }).checks.map((c) => c.id)).not.toContain("title-keyword");
    expect(reviewDraft({ ...base, title: "عید کے لیے خوبصورت لباس" }, { idea: "Eid outfits" }).checks.map((c) => c.id)).not.toContain("title-keyword");
  });
});

describe("SEO titles are enforced", async () => {
  const { ensureSeoTitle, mainKeyword, tidyDrafts } = await import("@/lib/drafts/tidyTitle");
  it("derives the main keyword from the idea", () => {
    expect(mainKeyword("Small living room decor ideas on a budget")).toBe("Small Living Room Decor Ideas on a Budget");
    expect(mainKeyword("Easy meal prep for busy weeknights")).toBe("Easy Meal Prep for Busy Weeknights");
    expect(mainKeyword("Winter shawl styling tips")).toBe("Winter Shawl Styling");
  });
  it("fixes the QA titles: keyword first, at least 40 characters", () => {
    const cases: [string, string][] = [
      ["Budget Decor: 5 ideas", "Small living room decor ideas on a budget"],
      ["Cozy Nights: easy meals", "Easy meal prep for busy weeknights"],
      ["Autumn Layers: 5 Trench Coat", "Layering a trench coat for autumn"],
      ["Tiny Room: maximize every inch", "Small living room decor ideas on a budget"],
      ["Meal Prep: fast dinners", "Easy meal prep for busy weeknights"],
    ];
    for (const [title, idea] of cases) {
      const out = ensureSeoTitle(title, idea);
      expect(out.length, out).toBeGreaterThanOrEqual(40);
      expect(out.length, out).toBeLessThanOrEqual(100);
    }
    expect(ensureSeoTitle("Cozy Nights: easy meals", "Easy meal prep for busy weeknights")).toBe("Easy Meal Prep for Busy Weeknights: easy meals");
    expect(ensureSeoTitle("Budget Decor: 5 ideas", "Small living room decor ideas on a budget")).toBe("Small Living Room Decor Ideas on a Budget: 5 ideas");
  });
  it("leaves good titles alone and skips other languages", () => {
    const good = "Small Living Room Decor: 7 budget ideas that make it feel bigger";
    expect(ensureSeoTitle(good, "Small living room decor ideas on a budget")).toBe(good);
    const ur = [{ title: "عید کے لیے لباس" }];
    expect(tidyDrafts(ur, "Eid outfits", "Urdu")).toEqual(ur);
  });
});

describe("descriptions and off-season words", async () => {
  const { tidyDescription, dropOffSeason } = await import("@/lib/drafts/tidyTitle");
  it("fixes the comma before the call to action", () => {
    expect(tidyDescription("Cozy layers for small rooms, Save this pin for later.")).toBe("Cozy layers for small rooms. Save this pin for later.");
  });
  it("drops a season the idea doesn't mention when it's out of season", () => {
    const nov = new Date("2026-11-25T12:00:00Z");
    expect(dropOffSeason("Summer small living room refresh", "Small living room decor", nov)).toBe("Small living room refresh");
    expect(dropOffSeason("Summer Linen Outfits", "Summer linen outfits", nov)).toBe("Summer Linen Outfits");
    expect(dropOffSeason("Cozy winter living room", "Small living room decor", nov)).toBe("Cozy winter living room");
  });
});
