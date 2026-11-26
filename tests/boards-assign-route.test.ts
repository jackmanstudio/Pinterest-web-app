import { describe, expect, it, vi } from "vitest";

const ledger = { mode: "memory", monthSpendUsd: async () => 0, record: async () => {}, recent: async () => [] };
vi.mock("@/lib/server/context", () => ({
  getRequestContext: async () => ({ mode: "demo", ledger }),
  workspaceIdFor: async () => "demo-fashion",
  workspaceFor: async () => ({ id: "demo-fashion", niche: "fashion" }),
  HttpError: class extends Error {},
}));
const calls: { keys: string[] }[] = [];
vi.mock("@/lib/ai/text", () => ({
  getTextProvider: () => ({
    name: "Test AI",
    source: "ai",
    generateDrafts: async () => ({}),
    assignBoards: async (input: { boards: { board_id: string; name: string }[]; pins: { key: string; title?: string }[] }) => {
      calls.push({ keys: input.pins.map((p) => p.key) });
      const linen = input.boards.find((b) => /summer|linen|outfit/i.test(b.name)) ?? input.boards[0];
      return {
        model: "test",
        usage: { input_tokens: 10, output_tokens: 10 },
        assignments: input.pins.map((p) => ({ key: p.key, category: "Outfit ideas", board_id: linen.board_id, confidence: 88, reason: "Fits.", new_board: null })),
      };
    },
  }),
}));

describe("POST /api/boards/assign", () => {
  it("uses the AI decision for every pin, with short keys in batches of 10", async () => {
    const { POST } = await import("@/app/api/boards/assign/route");
    const pins = Array.from({ length: 22 }, (_, i) => ({ key: `0000000${i}-aaaa-bbbb-cccc-dddddddddddd`, keyword: "Summer linen outfits", title: `Summer Linen Outfits ${i}` }));
    const req = new Request("http://localhost/api/boards/assign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
      body: JSON.stringify({ workspace: "fashion", pins, categories: ["Outfit ideas", "Seasonal trends"], settings: { mode: "auto", manual_board_id: null, manual_board_name: null, rules: [], keyword_plan: [] } }),
    });
    const body = await (await POST(req)).json();
    expect(body.engine).toBe("ai");
    expect(body.assignments).toHaveLength(22);
    expect(body.assignments.every((a: { method: string }) => a.method === "ai")).toBe(true);
    expect(body.assignments[0].key).toBe(pins[0].key);
    expect(calls.map((c) => c.keys.length)).toEqual([10, 10, 2]);
    expect(calls[0].keys[0]).toBe("p1");
  });
});

describe("keyword fallback", () => {
  it("doesn't pick a board just because it shares a broad word like 'fashion'", async () => {
    const { recommendBoard } = await import("@/lib/publishing/boards");
    const boards = [{ board_id: "b1", name: "Modest Fashion & Abayas" }, { board_id: "b2", name: "Summer Outfits" }];
    expect(recommendBoard(boards, { title: "Summer Linen Outfits", tags: ["linen"], category: "Fashion" })?.board.board_id).toBe("b2");
    expect(recommendBoard([boards[0]], { title: "Cozy Winter Outfit Ideas", tags: [], category: "Fashion" })).toBeNull();
    expect(recommendBoard([boards[0]], { title: "Eid abaya styling", tags: [], category: "Fashion" })?.board.board_id).toBe("b1");
  });
});
