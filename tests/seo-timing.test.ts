import { describe, expect, it } from "vitest";
import { daysToPeak, detectEvents, easter, nthWeekday, seasonTiming, SEASON_EVENTS } from "@/lib/seo/seasonality";
import { spreadTimes, zonedTime } from "@/lib/planning/spread";
import { reviewDraft } from "@/lib/drafts/quality";

const at = (s: string) => new Date(`${s}T12:00:00Z`);

describe("seasonal timing", () => {
  it("finds the holiday before the broad season", () => {
    expect(detectEvents("Cozy winter Christmas table ideas").map((e) => e.id)).toEqual(["christmas", "winter"]);
    expect(detectEvents("Linen shirt care guide")).toEqual([]);
    expect(detectEvents("Fall-proof shelves")[0]?.id).toBe("fall"); // word match, a known limit
  });
  it("computes moving dates", () => {
    expect(easter(2026)).toEqual([3, 5]);
    expect(easter(2027)).toEqual([2, 28]);
    expect(nthWeekday(2026, 10, 4, 4)).toEqual([10, 26]); // Thanksgiving 2026
    expect(nthWeekday(2027, 4, 0, 2)).toEqual([4, 9]); // Mother's Day 2027
  });
  it("rates timing", () => {
    const xmas = SEASON_EVENTS.find((e) => e.id === "christmas")!;
    expect(daysToPeak(xmas, at("2026-11-25"))).toBe(30);
    expect(seasonTiming("Christmas gift guide", at("2026-11-25")).status).toBe("ahead");
    expect(seasonTiming("Christmas gift guide", at("2026-12-22")).status).toBe("peak");
    expect(seasonTiming("Christmas gift guide", at("2026-12-27")).status).toBe("late");
    expect(seasonTiming("Christmas gift guide", at("2026-06-01")).status).toBe("off");
    expect(seasonTiming("Halloween costume ideas", at("2026-11-02")).status).toBe("off"); // tail of 1 day passed → next year
    expect(seasonTiming("Desk organisation", at("2026-06-01")).status).toBe("evergreen");
  });
  it("feeds the quality score only when today is given", () => {
    const d = { angle: "", concept: "", image_prompt: "", title: "Halloween costume ideas for the whole family", description: "Easy homemade Halloween costumes for kids and adults, with simple supplies and step by step tips.", tags: ["halloween costumes", "family costumes", "diy costumes"], alt_text: "A family dressed as pumpkins on a porch at dusk" };
    const plain = reviewDraft(d);
    const late = reviewDraft(d, { today: at("2026-11-01") });
    expect(late.checks.some((c) => c.id === "season-late")).toBe(true);
    expect(late.score).toBe(plain.score - 8);
    const good = reviewDraft(d, { today: at("2026-09-20"), trendKeywords: ["halloween costumes"] });
    expect(good.score).toBe(plain.score);
    expect(good.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["season-ahead", "trending"]));
  });
});

describe("spread schedule", () => {
  const tz = "America/New_York";
  it("converts local wall time", () => {
    expect(zonedTime(2026, 11, 1, 12, 0, tz).toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(zonedTime(2026, 6, 1, 12, 0, tz).toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });
  it("puts N per day inside the window, evenly", () => {
    const t = spreadTimes(5, { start: new Date("2026-12-01T05:00:00Z"), perDay: 3, fromHour: 12, toHour: 21, timeZone: tz });
    const local = t.map((d) => new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(d));
    expect(local).toEqual(["1, 13:30", "1, 16:30", "1, 19:30", "2, 13:30", "2, 16:30"]);
  });
  it("skips past slots, full days and slots too close to existing pins", () => {
    const existing = [new Date("2026-12-01T21:30:00Z")]; // 16:30 local on day 1
    const t = spreadTimes(3, { start: new Date("2026-12-01T19:05:00Z"), perDay: 2, fromHour: 12, toHour: 20, timeZone: tz, minGapMinutes: 60, existing });
    // Day 1: 14:00 is past, 18:00 is 90 min from 16:30 but the day already holds 1 → only 1 more.
    expect(t.map((d) => d.toISOString())).toEqual(["2026-12-01T23:00:00.000Z", "2026-12-02T19:00:00.000Z", "2026-12-02T23:00:00.000Z"]);
  });
});
