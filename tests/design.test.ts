import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { LAYOUTS, layoutForAngle, paletteForColor, resolvePalette, splitHeadline, contrastRatio, luminance } from "@/lib/brand/design";
import { designReport } from "@/lib/brand/check";
import { designerSvg, overlaySvg, readTemplate } from "@/lib/brand/template";
import { composePin } from "@/lib/brand/compose";
import { buildImagePrompt } from "@/lib/ai/image/prompt";
import { PIN_ANGLES } from "@/lib/drafts/angles";

describe("premium pin design", () => {
  it("gives every angle in a batch a different layout", () => {
    const layouts = PIN_ANGLES.map((a) => layoutForAngle(a.label));
    expect(new Set(layouts).size).toBe(5);
    expect([...layouts].sort()).toEqual([...LAYOUTS].sort());
    // Any first N pins (2, 3, 5…) are all different too.
    for (let n = 1; n <= 5; n++) expect(new Set(layouts.slice(0, n)).size).toBe(n);
  });

  it("splits SEO titles into a short headline and a kicker", () => {
    expect(splitHeadline("Layering a Trench Coat: A Simple 4-Step Guide")).toEqual({ headline: "Layering a Trench Coat", kicker: "A Simple 4-Step Guide", number: null });
    expect(splitHeadline("7 Autumn Outfits Worth Saving", "List / roundup")).toMatchObject({ headline: "Autumn Outfits Worth Saving", number: "7", kicker: "Ideas worth saving" });
    expect(splitHeadline("Dream Big: Quiet Inspiration for Bold Goals").headline).toBe("Quiet Inspiration for Bold Goals");
  });

  it("matches the palette to the photo", () => {
    expect(paletteForColor([0.05, 0.05, 0.05])).toBe("noir");
    expect(paletteForColor([0.45, 0.6, 0.42])).toBe("sage");
    expect(paletteForColor([0.15, 0.2, 0.45])).toBe("navy");
    expect(paletteForColor([0.85, 0.65, 0.68])).toBe("blush");
    expect(paletteForColor([0.9, 0.85, 0.78])).toBe("ivory");
    expect(resolvePalette("brand", "#b91c1c").accent).toBe("#b91c1c");
  });

  it("keeps headline text readable: large bold or serif type on the photo, high contrast", () => {
    const t = readTemplate({});
    for (const layout of LAYOUTS) {
      const { svg, meta } = designerSvg({ width: 1000, height: 1500, title: "Layering a Trench Coat for Autumn: A Simple Guide", template: t, tone: { top: 0.8, middle: 0.8, bottom: 0.8 } }, layout);
      expect(meta.headlineSize).toBeGreaterThanOrEqual(44);
      expect(meta.lines).toBeLessThanOrEqual(3);
      expect(meta.contrast).toBeGreaterThanOrEqual(4.5);
      expect(svg).toMatch(/Playfair Display|DM Serif Display|font-family="Poppins" font-size="[\d.]+" fill="#[0-9A-F]{6}" font-weight="700"/);
      expect(svg).not.toMatch(/fill="#F7F1E8"|fill="#EEF0E7"/); // no paper band or mat behind the text
      expect(svg).toContain('font-family="Poppins"'); // serif + sans pairing
      expect(svg).not.toMatch(/AI generated/i);
    }
    expect(contrastRatio(luminance("#ffffff"), luminance("#000000"))).toBeCloseTo(21, 0);
  });

  it("escapes titles and uses unique gradient ids per layout", () => {
    const svg = overlaySvg({ width: 1000, height: 1500, title: `<b>"x"</b> & y`, template: readTemplate({}), angle: "Inspiration / mood" });
    expect(svg).not.toContain("<b>");
    expect(svg).toMatch(/id="scrim-caption"/);
  });

  it("self-checks the design and flags weak photos for a retry", () => {
    const meta = { layout: "paper" as const, palette: resolvePalette("ivory", "#000"), headline: "x", headlineSize: 60, lines: 2, contrast: 12 };
    const good = designReport({ sharpness: 20, brightness: 0.5, saturation: 0.3, clipped: 0.01 }, meta);
    expect(good.score).toBe(100);
    expect(good.retryPhoto).toBe(false);
    expect(good.checks.find((c) => c.id === "eye")?.status).toBe("manual");
    const blurry = designReport({ sharpness: 1, brightness: 0.03, saturation: 0.9, clipped: 0.5 }, { ...meta, headlineSize: 30, contrast: 2 });
    expect(blurry.retryPhoto).toBe(true);
    expect(blurry.score).toBeLessThan(40);
  });

  it("composes a 1000×1500 JPEG with a design report", async () => {
    const base = await sharp({ create: { width: 800, height: 1200, channels: 3, background: "#c9b79c" } }).png().toBuffer();
    const out = await composePin({ base, title: "Cosy Winter Layers: Seasonal Edit", template: readTemplate({}), size: { width: 1000, height: 1500 }, angle: "Seasonal / timely" });
    const m = await sharp(Buffer.from(out.bytes)).metadata();
    expect([m.width, m.height, m.format]).toEqual([1000, 1500, "jpeg"]);
    expect(out.design.layout).toBe("centered");
    expect(readFileSync).toBeDefined();
  });

  it("writes the design guide into the image prompt", () => {
    const p = buildImagePrompt({ title: "Layering a trench coat", scene: "a woman in a trench coat", kind: "fashion", angle: "How-to / tutorial" });
    expect(p).toMatch(/premium creative agency/);
    expect(p).toMatch(/cream, beige and warm ivory/);
    expect(p).toMatch(/bold headline will be written straight over the top third/);
    expect(p).toMatch(/no text/);
    expect(buildImagePrompt({ title: "x", scene: "y", kind: "macro", angle: "Seasonal", palette: "sage" })).toMatch(/sage green/i);
  });
});

describe("pin sets", async () => {
  const { anglesFor, PIN_STYLE_KEYS } = await import("@/lib/drafts/angles");
  const { layoutForAngle } = await import("@/lib/brand/design");
  const { DemoTextProvider } = await import("@/lib/ai/text/demo");
  it("every set has five angles with five different layouts", () => {
    for (const s of PIN_STYLE_KEYS) {
      const a = anglesFor(s);
      expect(a).toHaveLength(5);
      expect(new Set(a.map((x) => layoutForAngle(x.label))).size).toBe(5);
    }
  });
  it("demo text follows the chosen set", async () => {
    const { EMPTY_BRAND } = await import("@/lib/types");
    const r = await new DemoTextProvider().generateDrafts({ workspace: "fashion", idea: "linen vs cotton shirts", brand: EMPTY_BRAND, style: "comparison" });
    expect(r.drafts[0].angle).toBe("Comparison: A vs B");
    expect(r.drafts[0].title).toMatch(/Which One Wins/);
  });
});
