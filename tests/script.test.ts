import { describe, expect, it } from "vitest";
import { cleanDrafts, draftsHaveStray, LOCAL_CTA, strayLetters, stripStray } from "@/lib/ai/text/script";

describe("stray script letters", () => {
  it("finds Chinese letters and Devanagari marks inside Urdu", () => {
    expect(strayLetters("عید کے لیے服", "Urdu")).toEqual(["服"]);
    expect(strayLetters("سر्یوں", "Urdu")).toEqual(["्"]);
    expect(strayLetters("بा", "Urdu")).toEqual(["ा"]);
  });
  it("drops the whole broken word, not just the letter", () => {
    expect(stripStray("عید کے لیے服: عید کی تیاری", "Urdu")).toBe("عید کے: عید کی تیاری");
    expect(stripStray("7 ीے سردیوں کی شال", "Urdu")).toBe("7 سردیوں کی شال");
    expect(stripStray("#服", "Urdu")).toBe("");
  });
  it("keeps Latin brand names, digits, harakat and the language's own script", () => {
    expect(strayLetters("Everlane کے 5 سویٹر", "Urdu")).toEqual([]);
    expect(strayLetters("عِید مُبارک", "Urdu")).toEqual([]);
    expect(strayLetters("ईद के लिए 5 Looks", "Hindi")).toEqual([]);
    expect(strayLetters("Café crème brûlée", "French")).toEqual([]);
    expect(strayLetters("Cozy 服 looks", "English")).toEqual(["服"]);
  });
  it("replaces an English call to action in an Urdu description with the Urdu one", () => {
    const out = stripStray("سردیوں میں شال اوڑھنے کے آسان طریقے۔ Save this pin for later.", "Urdu", { description: true });
    expect(out).toBe(`سردیوں میں شال اوڑھنے کے آسان طریقے۔ ${LOCAL_CTA.urdu}`);
    expect(stripStray("شال کے انداز۔ Wear it with a long coat today.", "Urdu", { description: true })).toBe("شال کے انداز۔");
  });
  it("cleans every field and flags drafts that need it", () => {
    const d = [{ title: "لباس 服", description: "عید", alt_text: "تصویر", tags: ["服", "عید لباس"] }];
    expect(draftsHaveStray(d, "Urdu")).toBe(true);
    expect(draftsHaveStray([{ ...d[0], title: "لباس", tags: [] , description: "عید۔ Save this pin for later." }], "Urdu")).toBe(true);
    expect(cleanDrafts(d, "Urdu")[0]).toEqual({ title: "لباس", description: "عید", alt_text: "تصویر", tags: ["عید لباس"] });
  });
});
