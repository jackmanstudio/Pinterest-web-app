/**
 * Premium pin design system: palettes, headline/kicker split, layout choice
 * per pin, and the five "Designer mix" layouts. Pure code (no Node APIs), so
 * the browser preview and the server compositor draw exactly the same pin.
 */

export const PALETTES = ["auto", "ivory", "sage", "noir", "blush", "navy", "brand"] as const;
export type PaletteName = (typeof PALETTES)[number];

export const PALETTE_LABELS: Record<PaletteName, string> = {
  auto: "Auto: matched to each photo",
  ivory: "Cream, beige & warm ivory",
  sage: "Sage green & soft neutrals",
  noir: "Black, white & champagne gold",
  blush: "Dusty rose & muted blush",
  navy: "Deep navy & elegant cream",
  brand: "My brand colour",
};

export interface Palette {
  /** Paper colour for bands and frames. */
  paper: string;
  /** Main text colour on paper. */
  ink: string;
  /** Accent for kickers, rules and numbers. */
  accent: string;
  /** Accent used on dark photo areas (must read on dark). */
  glow: string;
}

export const PALETTE_COLORS: Record<Exclude<PaletteName, "auto" | "brand">, Palette> = {
  ivory: { paper: "#F7F1E8", ink: "#2B2622", accent: "#A07F52", glow: "#EAD9BC" },
  sage: { paper: "#EEF0E7", ink: "#27322A", accent: "#6F8467", glow: "#D6E0CC" },
  noir: { paper: "#151413", ink: "#F7F3EC", accent: "#C9A96E", glow: "#E3CB97" },
  blush: { paper: "#F7EAE7", ink: "#4A2E35", accent: "#B97C84", glow: "#F2CFCF" },
  navy: { paper: "#F4EEE3", ink: "#1D2945", accent: "#1D2945", glow: "#E9DEC8" },
};

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

export function rgbToHsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** Picks the premium palette that harmonises with a photo's dominant colour (0-1 RGB). */
export function paletteForColor(rgb: [number, number, number]): Exclude<PaletteName, "auto" | "brand"> {
  const { h, s, l } = rgbToHsl(rgb);
  if (l < 0.22) return "noir";
  if (s < 0.12) return l > 0.6 ? "ivory" : "noir";
  if (h >= 70 && h < 170) return "sage";
  if (h >= 180 && h < 265) return "navy";
  if (h >= 300 || h < 18) return l > 0.45 ? "blush" : "noir";
  return "ivory";
}

/** Resolves the palette for one pin. `photoColor` is the photo's dominant colour, when known. */
export function resolvePalette(name: PaletteName, brandColor: string, photoColor?: [number, number, number] | null, fallback: Exclude<PaletteName, "auto" | "brand"> = "ivory"): Palette {
  if (name === "brand") return { ...PALETTE_COLORS.ivory, accent: brandColor, glow: lighten(brandColor) };
  if (name === "auto") return PALETTE_COLORS[photoColor ? paletteForColor(photoColor) : fallback];
  return PALETTE_COLORS[name];
}

function lighten(hex: string): string {
  const [r, g, b] = hexRgb(hex).map((v) => Math.round((v + (1 - v) * 0.55) * 255));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** The five Designer-mix layouts. */
export const LAYOUTS = ["paper", "framed", "caption", "editorial", "centered"] as const;
export type Layout = (typeof LAYOUTS)[number];

const ANGLE_LAYOUT: [RegExp, Layout][] = [
  [/how|tutorial|step|guide/i, "paper"],
  [/list|roundup|ideas/i, "framed"],
  [/inspir|mood/i, "caption"],
  [/problem|solution|fix|mistake/i, "editorial"],
  [/season|timely|trend/i, "centered"],
];

/** One layout per creative angle, so a batch of five never looks identical. */
export function layoutForAngle(angle: string | undefined, title = ""): Layout {
  for (const [re, layout] of ANGLE_LAYOUT) if (re.test(angle ?? "")) return layout;
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LAYOUTS[h % LAYOUTS.length];
}

/** Which palette a layout falls back to when the photo colour isn't known (keeps a batch varied). */
export const LAYOUT_PALETTE: Record<Layout, Exclude<PaletteName, "auto" | "brand">> = {
  paper: "ivory",
  framed: "sage",
  caption: "blush",
  editorial: "noir",
  centered: "navy",
};

const ANGLE_KICKER: [RegExp, string][] = [
  [/how|tutorial|step|guide/i, "Step-by-step guide"],
  [/list|roundup|ideas/i, "Ideas worth saving"],
  [/inspir|mood/i, "Inspiration"],
  [/problem|solution|fix/i, "The simple fix"],
  [/season|timely/i, "Seasonal edit"],
];

/**
 * Splits an SEO title into a short on-image headline and a small kicker line.
 * "Layering a Trench Coat: A Simple 4-Step Guide" → headline "Layering a Trench Coat",
 * kicker "A Simple 4-Step Guide". Without a separator the angle gives the kicker.
 */
export function splitHeadline(title: string, angle?: string): { headline: string; kicker: string; number: string | null } {
  const t = title.replace(/\s+/g, " ").trim();
  const m = /^(.{8,}?)\s*(?::|\s[–—|-]\s)\s*(.{4,})$/.exec(t);
  let headline = t;
  let kicker = "";
  if (m) {
    const [a, b] = [m[1].trim(), m[2].trim()];
    // Keep the more specific (longer) part as the headline when the first part is only a hook.
    if (a.split(" ").length >= 2 && a.length >= b.length * 0.6) [headline, kicker] = [a, b];
    else [headline, kicker] = [b, a];
  }
  if (!kicker) kicker = ANGLE_KICKER.find(([re]) => re.test(angle ?? ""))?.[1] ?? "";
  const num = /^(\d{1,2})\s+(.+)$/.exec(headline);
  return { headline: num ? num[2] : headline, kicker, number: num ? num[1] : null };
}
