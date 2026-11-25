import { describe, expect, it } from "vitest";
import { compactNumber, dateRange, freshness, parseAccountAnalytics, parsePinSummary, parseTopPins, parseTrends } from "@/lib/analytics/parse";
import { allowedNumbers, quotedNumbers, verifyInsights } from "@/lib/analytics/verify";
import { DemoTextProvider } from "@/lib/ai/text/demo";
import type { TextProvider } from "@/lib/ai/text/types";

describe("analytics parsing", () => {
  it("clamps ranges to Pinterest's 90-day window", () => {
    const today = new Date("2026-11-25T15:00:00Z");
    expect(dateRange(30, today)).toEqual({ start: "2026-10-27", end: "2026-11-25" });
    expect(dateRange(365, today).start).toBe("2026-08-28");
  });
  it("reads summary and sorted daily metrics from the 'all' split", () => {
    const a = parseAccountAnalytics({
      all: {
        summary_metrics: { IMPRESSION: 240, SAVE: 20 },
        daily_metrics: [
          { date: "2026-11-02", data_status: "PROCESSING", metrics: { IMPRESSION: 40 } },
          { date: "2026-11-01", data_status: "READY", metrics: { IMPRESSION: 200 } },
        ],
      },
    });
    expect(a.summary.IMPRESSION).toBe(240);
    expect(a.daily.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(a.daily[1].status).toBe("PROCESSING");
    expect(parseAccountAnalytics(null)).toEqual({ summary: {}, daily: [] });
  });
  it("parses top pins, pin summaries and trends defensively", () => {
    expect(parseTopPins({ pins: [{ pin_id: "1", metrics: { SAVE: 3 } }, { metrics: {} }] })).toEqual([{ pin_id: "1", metrics: { SAVE: 3 } }]);
    expect(parsePinSummary({ all: { summary_metrics: { SAVE: 9 } } })).toEqual({ SAVE: 9 });
    expect(parseTrends({ trends: [{ keyword: "trench", pct_growth_mom: 40 }] })[0]).toEqual({ keyword: "trench", pct_growth_wow: null, pct_growth_mom: 40, pct_growth_yoy: null });
  });
  it("formats freshness and compact numbers", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(freshness("2026-11-25T11:55:00Z", now)).toBe("5 min ago");
    expect(freshness("2026-11-25T09:00:00Z", now)).toBe("3 h ago");
    expect(compactNumber(12900)).toBe("12.9K");
  });
});

describe("insight verification", () => {
  const data = { account: { summary: { IMPRESSION: 24800, SAVE: 912, ENGAGEMENT_RATE: 0.061 } }, top_pins: [{ metrics: { SAVE: 212 } }] };
  it("collects allowed numbers in common formats", () => {
    const a = allowedNumbers(data);
    expect(a.has("24800")).toBe(true);
    expect(a.has("6.1")).toBe(true); // 0.061 as a percentage
    expect(a.has("212")).toBe(true);
  });
  it("normalises quoted numbers", () => {
    expect(quotedNumbers("Saves hit 1,284 with a 6.1% rate")).toEqual(["1284", "6.1"]);
  });
  it("keeps grounded insights and drops ones with invented numbers", () => {
    const grounded = { title: "Saves are strong", detail: "912 saves from 24,800 impressions.", evidence: "SAVE 912, IMPRESSION 24800, engagement 6.1%", action: "Post more list pins." };
    const invented = { title: "Beat competitors", detail: "You are 35% ahead of rivals with 50,000 followers.", evidence: "industry benchmark", action: "Keep going." };
    const r = verifyInsights([grounded, invented], data);
    expect(r.kept).toEqual([grounded]);
    expect(r.dropped).toEqual([invented]);
  });
  it("the demo text provider cannot generate insights", () => {
    const p: TextProvider = new DemoTextProvider();
    expect(p.generateInsights).toBeUndefined();
  });
});
