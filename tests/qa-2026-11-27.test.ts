import { describe, expect, it } from "vitest";
import { DemoTextProvider } from "@/lib/ai/text/demo";
import { toHashtag } from "@/lib/drafts/hashtag";
import { EMPTY_BRAND } from "@/lib/types";

const req = (idea: string) => ({ workspace: "modest-fashion-pk", idea, category: "Women's Fashion", brand: { ...EMPTY_BRAND } });

describe("hashtags", () => {
  it("drops apostrophes, hyphens and spaces, keeps any script", () => {
    expect(toHashtag("women's fashion")).toBe("#womensfashion");
    expect(toHashtag("modest-fashion ideas")).toBe("#modestfashionideas");
    expect(toHashtag("عید کے کپڑے")).toBe("#عیدکےکپڑے");
    expect(toHashtag("सर्दियों के कपड़े")).toBe("#सर्दियोंकेकपड़े");
    expect(toHashtag("!!")).toBe("");
  });
});

describe("fallback (demo) text", () => {
  it("doesn't repeat 'ideas' or put the account's URL slug in tags", async () => {
    const res = await new DemoTextProvider().generateDrafts(req("Eid outfit ideas for women"));
    const list = res.drafts.find((d) => /7 Fresh/.test(d.title))!;
    expect(list.title).toBe("7 Fresh Eid Outfit Ideas for Women");
    const tags = res.drafts.flatMap((d) => d.tags);
    expect(tags.some((t) => /ideas ideas|modest-fashion-pk/.test(t))).toBe(false);
  });
  it("keeps 'Ideas for' when the idea has no list word", async () => {
    const res = await new DemoTextProvider().generateDrafts(req("trench coat"));
    expect(res.drafts.some((d) => d.title === "7 Fresh Ideas for Trench Coat")).toBe(true);
  });
});

describe("SEO title padding", () => {
  it("doesn't add a second 'Ideas'", async () => {
    const { ensureSeoTitle } = await import("@/lib/drafts/tidyTitle");
    const t = ensureSeoTitle("7 Fresh Eid Outfit Ideas for Women", "Eid outfit ideas for women");
    expect(t.match(/ideas/gi)?.length).toBe(1);
    // Already carries the full keyword: it stays as is rather than getting generic filler ("to Save and Try").
    expect(t).toBe("7 Fresh Eid Outfit Ideas for Women");
  });
});
