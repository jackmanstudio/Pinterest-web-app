import { describe, expect, it } from "vitest";
import { findNearDuplicates, jaccard } from "@/lib/drafts/distinctness";
import { parseList } from "@/lib/drafts/validation";

const d = (title: string, description = title) => ({ angle: "", concept: "c", title, description, tags: ["t"], alt_text: "a", image_prompt: "p" });

describe("distinctness", () => {
  it("scores identical text as 1 and unrelated text as 0", () => {
    expect(jaccard("Autumn trench coat looks", "autumn TRENCH coat looks!")).toBe(1);
    expect(jaccard("Autumn trench coat", "macro dew droplets")).toBe(0);
  });
  it("flags near-duplicate drafts", () => {
    const dupes = findNearDuplicates([d("10 autumn trench coat outfits"), d("10 trench coat outfits for autumn"), d("Rainy day styling fix")]);
    expect(dupes.map((p) => [p.a, p.b])).toContainEqual([0, 1]);
    expect(dupes.some((p) => p.b === 2)).toBe(false);
  });
});

describe("parseList", () => {
  it("trims, drops empties and dedupes case-insensitively", () => {
    expect(parseList(" a, B ,, b, c ")).toEqual(["a", "B", "c"]);
  });
});
