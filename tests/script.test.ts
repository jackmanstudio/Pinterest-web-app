import { describe, expect, it } from "vitest";
import { cleanDrafts, draftsHaveStray, strayLetters, stripStray } from "@/lib/ai/text/script";

describe("stray script letters", () => {
  it("finds and strips Chinese inside Urdu", () => {
    expect(strayLetters("عید کے لیے服: عید کی تیاری کے لیے", "Urdu")).toEqual(["服"]);
    expect(stripStray("عید کے لیے服: عید کی تیاری کے لیے", "Urdu")).toBe("عید کے لیے: عید کی تیاری کے لیے");
    expect(stripStray("#服", "Urdu")).toBe("");
  });
  it("keeps Latin brand names, digits and the language's own script", () => {
    expect(strayLetters("Everlane کے 5 سویٹر", "Urdu")).toEqual([]);
    expect(strayLetters("ईद के लिए 5 Looks", "Hindi")).toEqual([]);
    expect(strayLetters("Café crème brûlée", "French")).toEqual([]);
    expect(strayLetters("Cozy 服 looks", "English")).toEqual(["服"]);
  });
  it("cleans every field and drops empty tags", () => {
    const d = [{ title: "لباس服", description: "服 عید", alt_text: "تصویر", tags: ["服", "عید لباس"] }];
    expect(draftsHaveStray(d, "Urdu")).toBe(true);
    expect(cleanDrafts(d, "Urdu")[0]).toEqual({ title: "لباس", description: "عید", alt_text: "تصویر", tags: ["عید لباس"] });
  });
});
