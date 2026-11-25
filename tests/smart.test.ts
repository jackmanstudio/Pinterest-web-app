import { describe, expect, it } from "vitest";
import { bestPostingHours, DEFAULT_HOURS, localHour, type PinSample } from "@/lib/autopilot/bestTime";
import { nextAllowedAt, runAutopilotStep, spacingMs, type AutopilotDeps, type AutopilotWorkspace } from "@/lib/autopilot/engine";
import { pickTrend, pickWinner, winnerIdea } from "@/lib/autopilot/sources";
import { seasonalIdeas } from "@/lib/ideas/seasonal";

const at = (hourUtc: number, day = 1) => new Date(Date.UTC(2026, 10, day, hourUtc, 15)).toISOString();
const pin = (hourUtc: number, saves: number, day = 1): PinSample => ({ created_at: at(hourUtc, day), saves, clicks: 0, outbound: 0, impressions: 0 });

describe("best posting time", () => {
  it("uses a labelled default until there is enough data", () => {
    const r = bestPostingHours([pin(19, 5), pin(20, 5)], "UTC");
    expect(r.basis).toBe("default");
    expect(r.hours).toEqual(DEFAULT_HOURS);
    expect(r.detail).toMatch(/default/i);
  });
  it("learns the strongest 3-hour windows from your pins", () => {
    const samples = [pin(19, 50, 1), pin(20, 40, 2), pin(7, 1, 3), pin(8, 2, 4), pin(13, 10, 5), pin(14, 12, 6), pin(1, 0, 7), pin(2, 1, 8), pin(22, 30, 9), pin(23, 20, 10)];
    const r = bestPostingHours(samples, "UTC");
    expect(r.basis).toBe("data");
    expect(r.hours).toContain(19);
    expect(r.hours).toContain(22);
    expect(r.hours).not.toContain(7);
    expect(r.detail).toMatch(/10 pins/);
  });
  it("buckets by the workspace's timezone", () => {
    expect(localHour("2026-11-01T14:00:00Z", "Asia/Karachi")).toBe(19);
    expect(localHour("2026-11-01T14:00:00Z", "Not/AZone")).toBe(14);
  });
});

describe("autopilot timing", () => {
  const ws: AutopilotWorkspace = { workspace_id: "w", owner_id: "u", kind: "fashion", board_id: "b", board_name: null, pins_per_day: 3, link: null, timezone: "UTC", best_time: true, remix_winners: false, auto_trends: false, trend_interest: null };
  const deps = (now: Date, hours: number[]): AutopilotDeps & { published: string[] } => {
    const published: string[] = [];
    return {
      published,
      now: () => now,
      readinessProblems: async () => [],
      postingHours: async () => hours,
      recentPublishes: async () => ({ count: 0, lastAt: null }),
      nextReadyDraft: async () => ({ id: "d1" }),
      ideas: { next: async () => null, finish: async () => {} },
      createPins: async () => 0,
      publish: async (_w, id) => (published.push(id), { ok: true }),
      setState: async () => {},
      isBudgetError: () => false,
    };
  };
  it("waits outside the best hours and posts inside them", async () => {
    const d1 = deps(new Date("2026-11-25T09:30:00Z"), [19, 20, 21]);
    const out = await runAutopilotStep(ws, d1);
    expect(out.action).toBe("waiting");
    expect(out.action === "waiting" && out.nextAt).toBe("2026-11-25T19:00:00.000Z");
    const d2 = deps(new Date("2026-11-25T19:30:00Z"), [19, 20, 21]);
    expect((await runAutopilotStep(ws, d2)).action).toBe("published");
  });
  it("ignores hours when best time is off", async () => {
    const d = deps(new Date("2026-11-25T09:30:00Z"), [19]);
    expect((await runAutopilotStep({ ...ws, best_time: false }, d)).action).toBe("published");
  });
  it("packs the daily pins into the allowed hours", () => {
    expect(spacingMs(3, 9)).toBe(Math.floor(3 * 3_600_000 * 0.9));
    expect(nextAllowedAt(new Date("2026-11-25T23:30:00Z"), [1], "UTC").toISOString()).toBe("2026-11-26T01:00:00.000Z");
  });
});

describe("idea sources", () => {
  it("remakes the best pin that hasn't been remade yet", () => {
    const c = [
      { pin_id: "a", title: "Linen outfits", saves: 10, outbound: 2, clicks: 5 },
      { pin_id: "b", title: "Trench coats", saves: 40, outbound: 1, clicks: 1 },
      { pin_id: "c", title: null, saves: 99, outbound: 0, clicks: 0 },
    ];
    expect(pickWinner(c, new Set())?.pin_id).toBe("b");
    expect(pickWinner(c, new Set(["b"]))?.pin_id).toBe("a");
    expect(winnerIdea("Trench coats")).toContain('"Trench coats"');
  });
  it("picks the fastest-growing unused trend that fits the brand", () => {
    const t = [
      { keyword: "quiet luxury", pct_growth_wow: 30, pct_growth_mom: null, pct_growth_yoy: null },
      { keyword: "barrel jeans", pct_growth_wow: 80, pct_growth_mom: null, pct_growth_yoy: null },
      { keyword: "air fryer recipes", pct_growth_wow: 200, pct_growth_mom: null, pct_growth_yoy: null },
    ];
    expect(pickTrend(t, new Set(), [], false)?.keyword).toBe("air fryer recipes");
    expect(pickTrend(t, new Set(["air fryer recipes"]), [], false)?.keyword).toBe("barrel jeans");
    expect(pickTrend(t, new Set(), ["jeans", "luxury"], true)?.keyword).toBe("barrel jeans");
  });
  it("suggests seasonal topics that look ahead to next month", () => {
    const ideas = seasonalIdeas("fashion", new Date(2026, 10, 25), ["capsule wardrobe"]);
    expect(ideas).toContain("Holiday gift guide for her");
    expect(ideas).toContain("Holiday party outfits");
    expect(ideas.some((i) => i.startsWith("capsule wardrobe"))).toBe(true);
    expect(seasonalIdeas("macro", new Date(2026, 0, 5)).length).toBeGreaterThan(0);
  });
});
