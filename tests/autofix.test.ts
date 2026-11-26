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
