import { describe, expect, it } from "vitest";
import { auditPins } from "@/lib/analytics/audit";
import { sampleSnapshots } from "@/lib/analytics/sample";
import type { PublishedPinStats } from "@/lib/analytics/types";

const now = new Date("2026-11-25T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const pin = (id: string, title: string, days: number | null, m: Record<string, number>, error?: string): PublishedPinStats => ({
  pin_id: id, draft_id: `d-${id}`, title, published_at: days === null ? null : ago(days), summary: m, ...(error ? { error } : {}),
});

describe("pin health check", () => {
  const stats = [
    pin("a", "Trench coat outfits", 120, { IMPRESSION: 1300, SAVE: 54, PIN_CLICK: 37, OUTBOUND_CLICK: 9 }),
    pin("b", "Linen shirt styling", 70, { IMPRESSION: 600, SAVE: 10, PIN_CLICK: 8, OUTBOUND_CLICK: 2 }),
    pin("c", "Capsule wardrobe checklist", 60, { IMPRESSION: 500, SAVE: 9, PIN_CLICK: 6, OUTBOUND_CLICK: 1 }),
    pin("d", "Desk setup ideas", 40, { IMPRESSION: 30, SAVE: 0, PIN_CLICK: 0, OUTBOUND_CLICK: 0 }),
    pin("e", "Seen but ignored", 40, { IMPRESSION: 800, SAVE: 1, PIN_CLICK: 0, OUTBOUND_CLICK: 0 }),
    pin("f", "Brand new pin", 3, { IMPRESSION: 20, SAVE: 0 }),
    pin("g", "Broken", 30, {}, "Pin not found"),
    pin("h", "Christmas table ideas", 300, { IMPRESSION: 2000, SAVE: 90, PIN_CLICK: 40, OUTBOUND_CLICK: 10 }),
    pin("i", "Beach bag essentials", 100, { IMPRESSION: 20, SAVE: 0, PIN_CLICK: 0, OUTBOUND_CLICK: 0 }),
  ];
  const byId = Object.fromEntries(auditPins(stats, now).map((h) => [h.pin_id, h]));
  it("rates against your own median, with a reason", () => {
    expect(byId.a.rating).toBe("strong");
    expect(byId.a.action).toBe("repin_fresh");
    expect(byId.b.rating).toBe("steady");
    expect(byId.d.rating).toBe("weak");
    expect(byId.d.reason).toMatch(/Few views/);
    expect(byId.d.action).toBe("rework");
    expect(byId.e.rating).toBe("weak");
    expect(byId.e.reason).toMatch(/only 1 save or click/);
  });
  it("doesn't judge new pins or pins without data", () => {
    expect(byId.f.rating).toBe("too_new");
    expect(byId.g.rating).toBe("no_data");
  });
  it("uses the season: refresh winners before their date, wait on off-season weak pins", () => {
    expect(byId.h.action).toBe("refresh_now");
    expect(byId.i.rating).toBe("weak");
    expect(byId.i.action).toBe("wait");
  });
  it("needs 3 settled pins before rating", () => {
    const few = auditPins(stats.slice(0, 2), now);
    expect(few.every((h) => h.rating === "steady")).toBe(true);
  });
  it("sample data covers every rating shown in the UI", () => {
    const s = sampleSnapshots(now).published_pins.data as PublishedPinStats[];
    const ratings = new Set(auditPins(s, now).map((h) => h.rating));
    expect([...ratings].sort()).toEqual(["steady", "strong", "too_new", "weak"]);
  });
});
