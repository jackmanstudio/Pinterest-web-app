import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composePin } from "@/lib/brand/compose";
import { DEFAULT_TEMPLATE, fitTitle, overlaySvg, readTemplate, wrapLines } from "@/lib/brand/template";

describe("brand template", () => {
  it("fills in defaults and rejects bad values", () => {
    expect(readTemplate(undefined)).toEqual(DEFAULT_TEMPLATE);
    const t = readTemplate({ style: "weird", primary_color: "red", handle: "@me" });
    expect(t.style).toBe("subtle");
    expect(t.primary_color).toBe(DEFAULT_TEMPLATE.primary_color);
    expect(t.handle).toBe("@me");
  });
  it("wraps and fits long titles into at most 4 lines", () => {
    expect(wrapLines("one two three four", 200, 50, "sans").length).toBeGreaterThan(1);
    const { lines, size } = fitTitle("How to Get the Autumn Trench Coat Outfits Look in 4 Easy Steps for Every Single Day", 840, "sans", 1);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(size).toBeGreaterThanOrEqual(40);
  });
  it("escapes the title so it can't break the SVG", () => {
    const svg = overlaySvg({ width: 1000, height: 1500, title: `<script>&"x"`, template: DEFAULT_TEMPLATE });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
  it("draws nothing for the 'none' style without a logo", () => {
    expect(overlaySvg({ width: 1000, height: 1500, title: "Hi", template: { ...DEFAULT_TEMPLATE, style: "none" } })).not.toContain("<text");
  });
});

describe("pin compositor", () => {
  it("returns a JPEG at the pin size with the overlay drawn", async () => {
    const base = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#3b82f6" } }).png().toBuffer();
    for (const style of ["subtle", "bold", "minimal", "elegant", "editorial", "none"] as const) {
      const out = await composePin({ base, title: "7 Autumn Trench Coat Outfits", template: { ...DEFAULT_TEMPLATE, style, handle: "@studio" }, size: { width: 1000, height: 1500 } });
      const meta = await sharp(Buffer.from(out.bytes)).metadata();
      expect(meta.format).toBe("jpeg");
      expect([meta.width, meta.height]).toEqual([1000, 1500]);
      const stats = await sharp(Buffer.from(out.bytes)).stats();
      // A flat blue image has ~0 variance; the overlay adds some unless style is "none".
      if (style === "none") expect(stats.channels[0].stdev).toBeLessThan(2);
      else expect(stats.channels[0].stdev).toBeGreaterThan(5);
    }
  });
});
