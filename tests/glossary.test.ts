import { describe, expect, it } from "vitest";
import { fixDraftSpelling, fixSpelling, glossaryHint } from "@/lib/ai/text/glossary";

describe("Urdu glossary", () => {
  it("asks for the standard spelling of festivals in the idea", () => {
    const h = glossaryHint("Urdu", "Eid outfit ideas for women");
    expect(h).toContain("eid = عید");
    expect(glossaryHint("Urdu", "Ramadan iftar table")).toContain("ramadan/ramzan = رمضان");
    expect(glossaryHint("Urdu", "linen shirts")).toBe("");
    expect(glossaryHint("English", "Eid outfits")).toBe("");
  });
  it("corrects the sound-alike spelling in every field", () => {
    expect(fixSpelling("ایڈی کے لیے خوبصورت لباس", "Urdu")).toBe("عید کے لیے خوبصورت لباس");
    expect(fixSpelling("#ایڈی، خواتین", "Urdu")).toBe("#عید، خواتین");
    // Not inside a longer word.
    expect(fixSpelling("ایڈیشن", "Urdu")).toBe("ایڈیشن");
    const [d] = fixDraftSpelling([{ title: "ایڈی لباس", description: "اس ایڈی پر", tags: ["ایڈی لباس"], alt_text: "ایڈی" }], "urdu");
    expect([d.title, d.description, d.tags[0], d.alt_text]).toEqual(["عید لباس", "اس عید پر", "عید لباس", "عید"]);
  });
});
