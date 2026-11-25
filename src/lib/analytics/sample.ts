import type { AccountAnalytics, PublishedPinStats, Snapshot, TopPin, TrendKeyword } from "./types";

/**
 * SAMPLE data for previewing the Analytics screen in Demo mode only.
 * The UI labels it "SAMPLE DATA" everywhere; it is never stored or sent to AI.
 */
export function sampleSnapshots(now = new Date()): Record<string, Snapshot<unknown>> {
  const days = 30;
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(now.getTime() - (days - 1 - i) * 86400_000);
    const wave = 1 + 0.35 * Math.sin(i / 3) + i / 40;
    return {
      date: d.toISOString().slice(0, 10),
      status: "READY",
      metrics: { IMPRESSION: Math.round(820 * wave), SAVE: Math.round(31 * wave), PIN_CLICK: Math.round(44 * wave), OUTBOUND_CLICK: Math.round(12 * wave) },
    };
  });
  const sum = (k: "IMPRESSION" | "SAVE" | "PIN_CLICK" | "OUTBOUND_CLICK") => daily.reduce((s, d) => s + d.metrics[k], 0);
  const account: AccountAnalytics = {
    summary: { IMPRESSION: sum("IMPRESSION"), SAVE: sum("SAVE"), PIN_CLICK: sum("PIN_CLICK"), OUTBOUND_CLICK: sum("OUTBOUND_CLICK"), ENGAGEMENT_RATE: 0.061 },
    daily,
  };
  const top: TopPin[] = [
    { pin_id: "sample-1", metrics: { IMPRESSION: 5400, SAVE: 212, PIN_CLICK: 160, OUTBOUND_CLICK: 41 } },
    { pin_id: "sample-2", metrics: { IMPRESSION: 3900, SAVE: 150, PIN_CLICK: 98, OUTBOUND_CLICK: 22 } },
    { pin_id: "sample-3", metrics: { IMPRESSION: 2100, SAVE: 77, PIN_CLICK: 61, OUTBOUND_CLICK: 15 } },
  ];
  const ago = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
  const published: PublishedPinStats[] = [
    { pin_id: "sample-9", draft_id: "x1", title: "7 Trench Coat Outfits Worth Saving", published_at: ago(120), summary: { IMPRESSION: 1300, SAVE: 54, PIN_CLICK: 37, OUTBOUND_CLICK: 9 } },
    { pin_id: "sample-10", draft_id: "x2", title: "Holiday Party Outfits: 5 Easy Looks", published_at: ago(330), summary: { IMPRESSION: 980, SAVE: 31, PIN_CLICK: 22, OUTBOUND_CLICK: 6 } },
    { pin_id: "sample-11", draft_id: "x3", title: "How to Style a Linen Shirt", published_at: ago(75), summary: { IMPRESSION: 640, SAVE: 12, PIN_CLICK: 9, OUTBOUND_CLICK: 2 } },
    { pin_id: "sample-12", draft_id: "x4", title: "Minimal Capsule Wardrobe Checklist", published_at: ago(60), summary: { IMPRESSION: 410, SAVE: 1, PIN_CLICK: 0, OUTBOUND_CLICK: 0 } },
    { pin_id: "sample-13", draft_id: "x5", title: "Summer Beach Bag Essentials", published_at: ago(90), summary: { IMPRESSION: 35, SAVE: 0, PIN_CLICK: 0, OUTBOUND_CLICK: 0 } },
    { pin_id: "sample-14", draft_id: "x6", title: "Cosy Knitwear Outfits for Winter", published_at: ago(4), summary: { IMPRESSION: 60, SAVE: 2, PIN_CLICK: 1, OUTBOUND_CLICK: 0 } },
  ];
  const trends: TrendKeyword[] = [
    { keyword: "trench coat outfit", pct_growth_wow: 18, pct_growth_mom: 64, pct_growth_yoy: 120 },
    { keyword: "autumn capsule wardrobe", pct_growth_wow: 9, pct_growth_mom: 41, pct_growth_yoy: 85 },
    { keyword: "layering outfits", pct_growth_wow: 6, pct_growth_mom: 27, pct_growth_yoy: 33 },
  ];
  const end = daily[daily.length - 1].date;
  const base = { environment: "sample", start_date: daily[0].date, end_date: end, params: {}, fetched_at: now.toISOString() };
  return {
    account: { id: "s1", kind: "account", source: "SAMPLE DATA (not from Pinterest)", ...base, data: account },
    top_pins: { id: "s2", kind: "top_pins", source: "SAMPLE DATA (not from Pinterest)", ...base, data: top },
    published_pins: { id: "s3", kind: "published_pins", source: "SAMPLE DATA (not from Pinterest)", ...base, data: published },
    trends: { id: "s4", kind: "trends", source: "SAMPLE DATA (not from Pinterest)", ...base, start_date: null, params: { region: "US", type: "growing" }, data: trends },
  };
}
