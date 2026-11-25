import { describe, expect, it } from "vitest";
import { placeImage } from "@/lib/tools/resize";

describe("resize placement", () => {
  const pin = { width: 1000, height: 1500 };
  it("fit keeps the whole pin visible, centred", () => {
    expect(placeImage(pin, { width: 1080, height: 1080 }, "fit")).toEqual({ x: 180, y: 0, w: 720, h: 1080 });
    expect(placeImage(pin, { width: 1200, height: 630 }, "fit")).toEqual({ x: 390, y: 0, w: 420, h: 630 });
  });
  it("fill covers the box and crops the edges", () => {
    expect(placeImage(pin, { width: 1080, height: 1080 }, "fill")).toEqual({ x: 0, y: -270, w: 1080, h: 1620 });
    const r = placeImage(pin, { width: 1080, height: 1920 }, "fill");
    expect(r.h).toBe(1920);
    expect(r.w).toBeGreaterThanOrEqual(1080);
  });
});
