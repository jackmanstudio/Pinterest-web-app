import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_SETTINGS,
  SAMPLE_BOARDS,
  acceptAiAssignment,
  boardChecks,
  boardNameKey,
  findBoardByName,
  groupByBoard,
  guessCategory,
  keywordAssign,
  parseKeywords,
  presetAssignments,
  suggestBoard,
} from "@/lib/boards/automation";

const boards = SAMPLE_BOARDS.macro;
const pin = (key: string, keyword: string, extra: object = {}) => ({ key, keyword, ...extra });

describe("category detection (fallback)", () => {
  it("finds the spec's example categories", () => {
    expect(guessCategory("bridal mehndi outfits for the wedding").category).toBe("Wedding");
    expect(guessCategory("easy chicken dinner recipe").category).toBe("Recipes & Food");
    expect(guessCategory("free budget planner printable").category).toBe("Printables");
    expect(guessCategory("christmas tree decor").category).toBe("Christmas");
    expect(guessCategory("zzz qqq").category).toBe("General");
  });
});

describe("keyword fallback assignment", () => {
  it("picks a related board", () => {
    const a = keywordAssign(pin("1", "easy dinner recipes", { title: "15 Easy Dinner Recipes" }), boards);
    expect(a.board_name).toBe("Easy Recipes");
    expect(a.method).toBe("keyword");
  });
  it("never forces an unrelated board and suggests a new one", () => {
    const a = keywordAssign(pin("1", "dog grooming tips"), boards);
    expect(a.board_id).toBeNull();
    expect(a.new_board?.name).toBeTruthy();
  });
});

describe("AI answers are validated", () => {
  const p = pin("1", "wedding table decor");
  it("accepts a real, confident board", () => {
    const a = acceptAiAssignment({ key: "1", category: "Wedding", board_id: "demo-ma-3", confidence: 88, reason: "Wedding decor", new_board: null }, p, boards);
    expect(a.board_name).toBe("Wedding Planning");
  });
  it("ignores a board id that isn't on the account", () => {
    const a = acceptAiAssignment({ key: "1", category: "Wedding", board_id: "someone-elses", confidence: 95, reason: "x", new_board: null }, p, boards);
    expect(a.board_id).toBeNull();
    expect(a.reason).toMatch(/isn't on this account/);
  });
  it("does not auto-assign low confidence picks", () => {
    const a = acceptAiAssignment({ key: "1", category: "Wedding", board_id: "demo-ma-3", confidence: 20, reason: "maybe", new_board: null }, p, boards);
    expect(a.board_id).toBeNull();
  });
  it("never suggests a duplicate board; uses the existing one", () => {
    const a = acceptAiAssignment({ key: "1", category: "Recipes", board_id: null, confidence: 30, reason: "food", new_board: { name: "easy   recipes!", description: "", keywords: [] } }, p, boards);
    expect(a.new_board).toBeNull();
    expect(a.board_name).toBe("Easy Recipes");
  });
});

describe("modes", () => {
  const pins = [pin("a", "wedding cake ideas"), pin("b", "living room decor")];
  it("manual sends every pin to one board", () => {
    const r = presetAssignments(pins, { ...DEFAULT_BOARD_SETTINGS, mode: "manual", manual_board_id: "demo-ma-1", manual_board_name: "Home Decor Ideas" }, boards);
    expect(r.done.map((d) => d.board_id)).toEqual(["demo-ma-1", "demo-ma-1"]);
    expect(r.rest).toHaveLength(0);
  });
  it("keyword rules apply first, the rest go to AI", () => {
    const r = presetAssignments(pins, { ...DEFAULT_BOARD_SETTINGS, mode: "rules", rules: [{ keyword: "wedding", board_id: "demo-ma-3", board_name: "Wedding Planning" }] }, boards);
    expect(r.done).toHaveLength(1);
    expect(r.done[0]).toMatchObject({ key: "a", method: "rule" });
    expect(r.rest.map((p) => p.key)).toEqual(["b"]);
  });
  it("rules pointing at a board not on the account are ignored", () => {
    const r = presetAssignments(pins, { ...DEFAULT_BOARD_SETTINGS, mode: "rules", rules: [{ keyword: "wedding", board_id: "gone", board_name: "Old" }] }, boards);
    expect(r.done).toHaveLength(0);
  });
  it("the bulk keyword plan is used for pins made from that keyword", () => {
    const r = presetAssignments(pins, { ...DEFAULT_BOARD_SETTINGS, keyword_plan: [{ keyword: "Living Room Decor", category: "Home Decor", board_id: "demo-ma-1", board_name: "Home Decor Ideas" }] }, boards);
    expect(r.done[0]).toMatchObject({ key: "b", method: "plan" });
  });
  it("automatic sends everything to AI", () => {
    expect(presetAssignments(pins, DEFAULT_BOARD_SETTINGS, boards).rest).toHaveLength(2);
  });
});

describe("pre-schedule checks", () => {
  const facts = pin("1", "easy dinner recipes", { title: "Easy dinner recipes" });
  it("flags a missing board", () => {
    expect(boardChecks(null, boards, { connectedUsername: "me", demo: false, facts })[0].ok).toBe(false);
  });
  it("flags a board not on the account", () => {
    const c = boardChecks("nope", boards, { connectedUsername: "me", demo: false, facts });
    expect(c.find((x) => x.id === "valid")?.ok).toBe(false);
  });
  it("passes a valid, owned, related board", () => {
    const c = boardChecks("demo-ma-2", boards, { connectedUsername: "me", demo: false, facts });
    expect(c.every((x) => x.ok)).toBe(true);
  });
  it("warns when the board looks unrelated", () => {
    const c = boardChecks("demo-ma-6", boards, { connectedUsername: "me", demo: false, facts });
    expect(c.find((x) => x.id === "related")?.ok).toBe(false);
  });
  it("demo boards are never treated as owned", () => {
    const c = boardChecks("demo-ma-2", boards, { connectedUsername: null, demo: true, facts });
    expect(c.find((x) => x.id === "owned")?.ok).toBe(false);
  });
});

describe("helpers", () => {
  it("parses up to 50 unique keywords", () => {
    const many = Array.from({ length: 60 }, (_, i) => `kw ${i}`).join("\n");
    expect(parseKeywords(many)).toMatchObject({ dropped: 10 });
    expect(parseKeywords("a\nA\n b ,c").keywords).toEqual(["a", "b", "c"]);
  });
  it("board names compare loosely", () => {
    expect(boardNameKey("Home & Decor!")).toBe(boardNameKey("home and decor"));
    expect(findBoardByName(boards, "easy recipes")?.board_id).toBe("demo-ma-2");
  });
  it("suggestBoard refuses existing names", () => {
    expect(suggestBoard("Travel", "beach", [{ board_id: "x", name: "Travel Ideas" }])).toBeNull();
    expect(suggestBoard("Pets", "dog grooming", boards)?.name).toBe("Pets Ideas");
  });
  it("groups by board, unassigned last", () => {
    const g = groupByBoard([
      { board_id: null, board_name: null },
      { board_id: "1", board_name: "A" },
      { board_id: "1", board_name: "A" },
    ]);
    expect(g.map((x) => x.board_name)).toEqual(["A", "No board yet"]);
  });
});
