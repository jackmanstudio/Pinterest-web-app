import { describe, expect, it } from "vitest";
import { autoFixDraft } from "@/lib/drafts/autofix";
import { reviewDraft } from "@/lib/drafts/quality";

const base = {
  angle: "Listicle", concept: "Cozy living room with layered throws",
  title: "Cozy Rooms",
  description: "Warm blankets, soft lamps and wooden textures make a small living room feel calm and inviting all winter long",
  tags: ["cozy living room", "winter decor", "home decor"],
  alt_text: "Living room",
  image_prompt: "A cozy small living room with layered wool throws, a warm floor lamp and wooden side tables. Soft light.",
};

describe("autoFixDraft", () => {
  it("fixes the short title, missing punctuation and missing link", () => {
    const ctx = { idea: "cozy winter living room ideas", website: "mybrand.com", today: new Date("2026-11-26") };
    const r = autoFixDraft(base, null, ctx);
    expect(r.content.title.length).toBeGreaterThanOrEqual(40);
    expect(r.content.title.length).toBeLessThanOrEqual(80);
    expect(r.content.title.toLowerCase()).toContain("living room");
    expect(r.content.description).toMatch(/[.!?]$/);
    expect(r.link).toBe("https://mybrand.com/");
    expect(r.after).toBeGreaterThan(r.before);
    const ids = reviewDraft(r.content, { ...ctx, link: r.link }).checks.map((c) => c.id);
    for (const id of ["title-short", "title-shortish", "ending", "link-missing", "alt-short", "title-keyword"]) expect(ids).not.toContain(id);
    expect(r.changes.map((c) => c.field)).toEqual(expect.arrayContaining(["Title", "Description", "Link", "Alt text"]));
  });
  it("leaves a clean pin alone and never touches non-English text beyond punctuation", () => {
    const good = autoFixDraft({ ...base, title: "Cozy Winter Living Room Ideas for Small Spaces That Feel Warm", description: base.description + ".", alt_text: base.image_prompt.split(". ")[0] + "." }, "https://x.com/a", { idea: "cozy winter living room ideas" });
    expect(good.changes).toEqual([]);
    const urdu = autoFixDraft({ ...base, title: "عید کے لیے خوبصورت لباس", description: "عید کے لیے خوبصورت لباس" }, "https://x.com", {});
    expect(urdu.content.title).toBe("عید کے لیے خوبصورت لباس");
    expect(urdu.content.description).toBe("عید کے لیے خوبصورت لباس.");
  });
  it("cleans shouting, repeats, hashtags and claims", () => {
    const r = autoFixDraft({ ...base, title: "BEST Cozy Living Room Room Ideas GUARANTEED!!", description: base.description + " #homedecor #cozy", tags: ["cozy", "cozy"] }, "http://x.com", { idea: "cozy living room" });
    expect(r.content.title).not.toMatch(/GUARANTEED|!!|Room Room|!:/i);
    expect(r.content.description).not.toContain("#");
    expect(r.content.tags).toContain("homedecor");
    expect(r.link).toBe("https://x.com");
  });
});

describe("autoFixDraft: keyword stuffing, generic words, keyword position", () => {
  const stuffed = {
    ...base,
    title: "Winter Long Shoes With an Overcoat for Cold City Days",
    description:
      "Winter long shoes pair well with a winter overcoat. Pick winter boots in leather, add a winter scarf, and keep winter layers simple so the outfit stays warm on cold city walks.",
    tags: ["winter long shoes", "overcoat outfit", "winter boots"],
    alt_text: "A woman in a camel overcoat and tall black leather boots walking on a snowy street",
  };
  it("removes extra repeats so the stuffing warning goes away and the score goes up", () => {
    const ctx = { idea: "winter long shoes with overcoat", today: new Date("2026-11-27") };
    expect(reviewDraft(stuffed, { ...ctx, link: "https://x.com" }).checks.map((c) => c.id)).toContain("stuffing");
    const r = autoFixDraft(stuffed, "https://x.com", ctx);
    const ids = reviewDraft(r.content, { ...ctx, link: r.link }).checks.map((c) => c.id);
    expect(ids).not.toContain("stuffing");
    expect(r.after).toBeGreaterThan(r.before);
    expect((r.content.description.match(/winter/gi) ?? []).length).toBeLessThanOrEqual(3);
    expect(r.content.description).not.toMatch(/\s[,.]|,\s*,|\band\s*[,.]/);
    expect(r.changes.find((c) => c.field === "Description")?.why).toMatch(/winter/);
  });
  it("drops generic phrases and moves a late main keyword to the front", () => {
    const r = autoFixDraft(
      { ...stuffed, title: "Warm and Polished Looks for Busy Weekday Mornings: Winter Long Shoes", description: "Ideas worth saving: tall leather boots and a camel overcoat keep you warm and sharp on cold city mornings this season." },
      "https://x.com",
      { idea: "winter long shoes" },
    );
    expect(r.content.title.toLowerCase().indexOf("winter long shoes")).toBe(0);
    expect(r.content.description.toLowerCase()).not.toContain("worth saving");
    const ids = reviewDraft(r.content, { idea: "winter long shoes", link: r.link }).checks.map((c) => c.id);
    expect(ids).not.toContain("title-front");
    expect(ids).not.toContain("generic");
  });
});
