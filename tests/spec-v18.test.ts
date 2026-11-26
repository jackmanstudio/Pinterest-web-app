import { describe, expect, it, vi } from "vitest";
import { defaultCategories, detectCategory, TAXONOMY_40 } from "@/lib/categories/taxonomy";
import { reviewDraft } from "@/lib/drafts/quality";
import { buildUtmUrl, readUtm, slugify } from "@/lib/tools/utm";
import { draftsToCsv, parseCsv, toCsv, validateImport } from "@/lib/tools/csv";
import { checkUrl, isPrivateAddress } from "@/lib/tools/urlCheck";
import { EMPTY_FILTER, filterDrafts, libraryDuplicates } from "@/lib/library/filter";
import { recommendBoard } from "@/lib/publishing/boards";
import { calendarItems, dayKey, monthGrid, weekDays } from "@/lib/planning/calendar";
import { workspaceHealth } from "@/lib/account/health";
import { draftsUserPrompt } from "@/lib/ai/text/prompt";
import { type KeyValue } from "@/lib/store/local";
import { EMPTY_BRAND, type Category, type PinDraft } from "@/lib/types";
import { seededStore } from "./seed";

class MemoryKV implements KeyValue {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const content = {
  angle: "Guide", concept: "c",
  title: "How to Layer a Trench Coat for Autumn Weekends",
  description: "Five easy ways to layer a trench coat for crisp autumn weekends, from knit sweaters to light scarves. Save this for your next cold morning.",
  tags: ["trench coat", "autumn outfits", "layering"],
  alt_text: "A woman in a beige trench coat and cream knit sweater walking on a leafy city street",
  image_prompt: "p",
};
let n = 0;
function pin(over: Partial<PinDraft> = {}): PinDraft {
  n++;
  return {
    ...content, id: `p${n}`, workspace_id: "w", category_id: null, batch_id: `b${n}`, idea: "trench", image_status: "ready", image_path: null, image_source: null,
    status: "draft", link: "https://example.com/trench", board_id: null, board_name: null, review_note: null, approved_at: null, scheduled_for: null,
    published_at: null, external_pin_id: null, source: "ai", archived_at: null, duplicate_of: null,
    created_at: "2026-11-20T10:00:00.000Z", updated_at: "2026-11-20T10:00:00.000Z", ...over,
  };
}

describe("40-category taxonomy", () => {
  it("has 40 categories: Macro gets all, Fashion the first ten", () => {
    expect(TAXONOMY_40).toHaveLength(40);
    expect(defaultCategories("macro")).toHaveLength(40);
    expect(defaultCategories("fashion")).toEqual(TAXONOMY_40.slice(0, 10));
  });
  it("detects the category from a title", () => {
    const cats: Category[] = TAXONOMY_40.map((name, i) => ({ id: `c${i}`, name, parent_id: null }));
    expect(detectCategory("Easy chocolate chip cookies for beginners", cats)?.category.name).toBe("Baking & Desserts");
    expect(detectCategory("Morning yoga workout for strength", cats)?.category.name).toBe("Fitness & Exercise");
    expect(detectCategory("Best gold necklace and earrings sets", cats)?.category.name).toBe("Jewelry & Watches");
    expect(detectCategory("Small living room interior with a green sofa", cats)?.category.name).toBe("Interior Design");
    expect(detectCategory("qwerty zzz", cats)).toBeNull();
  });
  it("prefers a matching sub-category the user created", () => {
    const cats: Category[] = [
      { id: "p", name: "Recipes & Cooking", parent_id: null },
      { id: "s", name: "Biryani", parent_id: "p" },
    ];
    expect(detectCategory("Chicken biryani recipe for Eid", cats)?.category.id).toBe("s");
  });
  it("new demo workspaces start with the spec taxonomy", async () => {
    const store = seededStore(new MemoryKV());
    const m = await store.getWorkspace("macro");
    expect(await store.listCategories(m.id)).toHaveLength(40);
  });
});

describe("quality score", () => {
  it("gives clean copy a high score", () => {
    const r = reviewDraft(content, { link: "https://example.com" });
    expect(r.score).toBeGreaterThanOrEqual(85);
  });
  it("explains each problem it finds", () => {
    const r = reviewDraft(
      { ...content, title: "TIPS", description: "Guaranteed results!! coat coat coat coat best", tags: ["x"], alt_text: "" },
      { bannedWords: ["best"], link: null, requireLink: true },
    );
    const ids = r.checks.map((c) => c.id);
    for (const id of ["title-short", "title-vague", "desc-short", "stuffing", "tags-few", "alt-missing", "banned", "claims", "punct", "link-missing"]) expect(ids).toContain(id);
    expect(r.score).toBeLessThan(40);
  });
});

describe("UTM builder", () => {
  it("adds UTM tags and keeps other params and the fragment", () => {
    const u = buildUtmUrl("https://shop.com/p?id=7&utm_source=old#top", { source: "pinterest", medium: "social", campaign: "fall", content: "" });
    expect(u).toBe("https://shop.com/p?id=7&utm_source=pinterest&utm_medium=social&utm_campaign=fall#top");
    expect(readUtm(u)).toEqual({ source: "pinterest", medium: "social", campaign: "fall" });
    expect(slugify("Autumn Trench Coats!")).toBe("autumn-trench-coats");
    expect(() => buildUtmUrl("javascript:alert(1)", { source: "a", medium: "b", campaign: "c" })).toThrow();
  });
});

describe("CSV import/export", () => {
  it("round-trips quotes, commas and newlines and blocks formulas", () => {
    const csv = toCsv(["a", "b"], [['He said "hi", ok', "line1\nline2"], ["=SUM(A1)", "x"]]);
    expect(parseCsv(csv)).toEqual([["a", "b"], ['He said "hi", ok', "line1\nline2"], ["'=SUM(A1)", "x"]]);
  });
  it("validates rows before import", () => {
    const r = validateImport("idea,link,tags\nTrench coat outfits,https://a.com/x,coat;fall\nTrench coat outfits,,\nhi,,\nGood idea here,not a url,\n");
    expect(r.fatal).toBeNull();
    expect(r.valid.map((x) => x.line)).toEqual([2]);
    expect(r.valid[0].tags).toEqual(["coat", "fall"]);
    expect(r.rows[1].errors).toContain("Duplicate of an earlier row");
    expect(r.rows[2].errors[0]).toMatch(/too short/);
    expect(r.rows[3].errors).toContain("Link is not a valid http(s) address");
    expect(validateImport("foo,bar\n1,2").fatal).toMatch(/header/);
  });
  it("exports drafts with category names", () => {
    const out = draftsToCsv([pin({ category_id: "c1" })], () => "Women's Fashion");
    expect(out.split("\r\n")[0]).toContain("title");
    expect(out).toContain("Women's Fashion");
  });
});

describe("URL checker", () => {
  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
  it("refuses bad syntax and private hosts without fetching", async () => {
    const f = vi.fn();
    expect((await checkUrl("not a url", "", f)).syntaxOk).toBe(false);
    const r = await checkUrl("http://127.0.0.1/admin", "", f);
    expect(r.reachable).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("follows redirects and compares the page title", async () => {
    const f = vi.fn(async (u: URL | string) =>
      String(u).endsWith("/old")
        ? new Response(null, { status: 301, headers: { location: "/new" } })
        : new Response("<html><title>Trench coat outfit guide</title></html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const r = await checkUrl("https://8.8.8.8/old", "Trench coat looks", f as unknown as typeof fetch);
    expect(r.reachable).toBe(true);
    expect(r.redirects).toBe(1);
    expect(r.topicMatch).toBe("match");
  });
});

describe("pin library", () => {
  it("filters by keyword, status, category and archive", () => {
    const a = pin({ title: "Red dress ideas", status: "approved", category_id: "c1" });
    const b = pin({ title: "Blue jeans", archived_at: "2026-11-21T00:00:00Z" });
    const c = pin({ title: "Green scarf", category_id: "c2" });
    const all = [a, b, c];
    expect(filterDrafts(all, { ...EMPTY_FILTER, q: "red dress" })).toEqual([a]);
    expect(filterDrafts(all, { ...EMPTY_FILTER, status: "approved" })).toEqual([a]);
    expect(filterDrafts(all, EMPTY_FILTER)).toEqual([a, c]);
    expect(filterDrafts(all, { ...EMPTY_FILTER, status: "archived" })).toEqual([b]);
    expect(filterDrafts(all, { ...EMPTY_FILTER, categoryId: "c0" }, () => ["c2"])).toEqual([c]);
  });
  it("flags near-duplicates across batches but not intentional copies", () => {
    const a = pin();
    const b = pin();
    const copy = pin({ duplicate_of: a.id });
    const other = pin({ title: "Something completely different here" });
    const d = libraryDuplicates([a, b, copy, other]);
    expect(d.get(a.id)).toContain(b.id);
    expect(d.get(a.id)).not.toContain(copy.id);
    expect(d.has(other.id)).toBe(false);
  });
  it("demo store keeps versions, duplicates and archives", async () => {
    const store = seededStore(new MemoryKV());
    const f = await store.getWorkspace("fashion");
    const [d] = await store.saveDrafts(f.id, [{ ...content, idea: "i", batch_id: "b", category_id: null, source: "ai" }]);
    await store.updateDraft(f.id, d.id, { title: "New title for this pin" });
    const v = await store.listVersions(f.id, d.id);
    expect(v).toHaveLength(1);
    expect(v[0].title).toBe(content.title);
    const copy = await store.duplicateDraft(f.id, d.id);
    expect(copy.duplicate_of).toBe(d.id);
    const archived = await store.updateDraft(f.id, d.id, { archived_at: "2026-11-25T00:00:00Z" });
    expect(archived.archived_at).toBeTruthy();
    expect(await store.listVersions(f.id, d.id)).toHaveLength(1); // archiving is not a text change
    const renamed = await store.renameWorkspace(f.id, "Style Diary");
    expect(renamed.name).toBe("Style Diary");
  });
});

describe("board recommendation", () => {
  it("picks the board that matches the pin", () => {
    const boards = [{ board_id: "1", name: "Home ideas" }, { board_id: "2", name: "Autumn Outfits" }, { board_id: "3", name: "Recipes" }];
    expect(recommendBoard(boards, { title: "Cozy autumn outfit ideas", tags: ["fall outfits"] })?.board.board_id).toBe("2");
    expect(recommendBoard(boards, { title: "Quantum physics", tags: [] })).toBeNull();
  });
});

describe("calendar", () => {
  it("builds month and week grids starting Monday", () => {
    const g = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(g).toHaveLength(42);
    expect(g[0].getDay()).toBe(1);
    expect(dayKey(g[6])).toBe("2026-11-01");
    const w = weekDays(new Date(2026, 10, 25));
    expect(dayKey(w[0])).toBe("2026-11-23");
  });
  it("places pins on publish, schedule or created day", () => {
    const m = calendarItems([
      pin({ published_at: "2026-11-10T12:00:00", created_at: "2026-11-01T12:00:00" }),
      pin({ status: "scheduled", scheduled_for: "2026-11-12T09:00:00" }),
      pin({ created_at: "2026-11-15T09:00:00" }),
      pin({ created_at: "2026-11-15T09:00:00", archived_at: "2026-11-16T00:00:00" }),
    ]);
    expect(m.get("2026-11-10")?.[0].kind).toBe("published");
    expect(m.get("2026-11-12")?.[0].kind).toBe("scheduled");
    expect(m.get("2026-11-15")).toHaveLength(1);
  });
});

describe("account health", () => {
  it("counts and recommends from the app's own data", () => {
    const now = new Date("2026-11-25T00:00:00Z").getTime();
    const h = workspaceHealth([pin({ status: "in_review" }), pin({ image_status: "not_generated" })], { ...EMPTY_BRAND }, now);
    expect(h.byStatus.in_review).toBe(1);
    expect(h.noImage).toBe(1);
    expect(h.recommendations.some((r) => r.href === "publish" && r.priority === "high")).toBe(true);
    expect(h.recommendations.some((r) => r.href === "settings")).toBe(true);
  });
});

describe("language and brand extras in the prompt", () => {
  it("asks for the chosen language, CTA, image style and market", () => {
    const p = draftsUserPrompt({
      workspace: "fashion", idea: "Eid outfits", language: "Urdu",
      brand: { ...EMPTY_BRAND, cta: "Save for Eid", image_style: "Editorial photography", region: "Pakistan" },
    });
    expect(p).toMatch(/natively in Urdu/);
    expect(p).toMatch(/Save for Eid/);
    expect(p).toMatch(/Editorial photography/);
    expect(p).toMatch(/Pakistan/);
    expect(draftsUserPrompt({ workspace: "fashion", idea: "x", brand: EMPTY_BRAND })).not.toMatch(/Language:/);
  });
});
