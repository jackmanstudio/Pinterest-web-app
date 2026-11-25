import { describe, expect, it } from "vitest";
import { detectCategory, defaultCategories } from "@/lib/categories/taxonomy";
import type { Category } from "@/lib/types";

const cats = (names: string[]) => names.map((name, i) => ({ id: `c${i}`, name, parent_id: null }) as unknown as Category);

describe("auto category", () => {
  it("matches custom category names through concept words", () => {
    const own = cats(["Outfit ideas", "Seasonal trends", "Styling tips", "Accessories", "Beauty"]);
    expect(detectCategory("Layering a trench coat for autumn", own)?.category.name).toMatch(/Seasonal trends|Styling tips|Outfit ideas/);
    expect(detectCategory("Eid outfit ideas for women", own)).not.toBeNull();
    expect(detectCategory("How to wear a silk scarf", own)?.category.name).toMatch(/Styling tips|Accessories/);
    expect(detectCategory("Quarterly tax filing", own)).toBeNull();
  });
  it("still works with the built-in taxonomy and plurals", () => {
    const t = cats(defaultCategories("fashion"));
    expect(detectCategory("Layering a trench coat for autumn", t)).not.toBeNull();
    expect(detectCategory("Best tote bags for work", t)?.category.name).toBe("Bags & Handbags");
  });
});
