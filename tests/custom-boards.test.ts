import { describe, expect, it } from "vitest";
import { checkNewBoardName, cleanBoardName, isLocalBoard, localBoard, mergeBoards } from "@/lib/boards/custom";

const real = [{ board_id: "111", name: "Home Decor Ideas" }];

describe("custom boards from the board picker", () => {
  it("cleans and caps a typed name", () => {
    expect(cleanBoardName("  Winter   Outfits ")).toBe("Winter Outfits");
    expect(cleanBoardName("x".repeat(80))).toHaveLength(50);
  });

  it("rejects empty names and picks an existing board instead of a duplicate", () => {
    expect(checkNewBoardName("  !! ", real).ok).toBe(false);
    const dup = checkNewBoardName("home decor  ideas", real);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.existing?.board_id).toBe("111");
    expect(checkNewBoardName("Winter Outfits", real)).toEqual({ ok: true, name: "Winter Outfits" });
  });

  it("makes local boards that are marked as app-only", () => {
    const b = localBoard("Winter Outfits");
    expect(isLocalBoard(b.board_id)).toBe(true);
    expect(isLocalBoard("111")).toBe(false);
  });

  it("hides a local board once Pinterest has one with the same name", () => {
    const merged = mergeBoards(real, [localBoard("Home Decor Ideas"), localBoard("Winter Outfits")]);
    expect(merged.map((b) => b.name)).toEqual(["Home Decor Ideas", "Winter Outfits"]);
  });
});
