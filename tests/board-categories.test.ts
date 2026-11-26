import { describe, expect, it } from "vitest";
import { boardCategories, cleanBoardCategories, detectBoardCategory, keywordAssign, SAMPLE_BOARDS, withBoardCategories } from "@/lib/boards/automation";

describe("board categories", () => {
  it("detects a board's category from its name and description", () => {
    expect(detectBoardCategory({ name: "Easy Recipes", description: "Quick dinner and dessert recipes" })).toBe("Recipes & Food");
    expect(detectBoardCategory({ name: "Wedding Planning", description: "Bridal ideas" })).toBe("Wedding");
    expect(detectBoardCategory({ name: "Random stuff", description: "" })).toBe("General");
  });

  it("prefers the account's own categories", () => {
    expect(detectBoardCategory({ name: "Modest Fashion & Abayas" }, ["Modest Fashion", "Shoes & Footwear"])).toBe("Modest Fashion");
  });

  it("lets the user's pick win over the detected category", () => {
    const boards = SAMPLE_BOARDS.macro;
    const cats = boardCategories(boards, { "demo-ma-1": "Cozy Living" });
    expect(cats["demo-ma-1"]).toEqual({ category: "Cozy Living", source: "custom" });
    expect(cats["demo-ma-2"]).toEqual({ category: "Recipes & Food", source: "auto" });
  });

  it("uses the board category when matching pins", () => {
    const boards = withBoardCategories(
      [
        { board_id: "a", name: "Saturday Things", description: "" },
        { board_id: "b", name: "Misc", description: "" },
      ],
      { a: "Recipes & Food" },
    );
    const pick = keywordAssign({ key: "p", keyword: "chocolate cake recipe", title: "Easy chocolate cake recipe for dinner" }, boards);
    expect(pick.board_id).toBe("a");
    expect(pick.reason).toMatch(/category/i);
  });

  it("cleans saved picks", () => {
    expect(cleanBoardCategories({ a: "  Food ", b: "", c: "x".repeat(200) }, new Set(["a", "c"]))).toEqual({ a: "Food", c: "x".repeat(80) });
  });
});
