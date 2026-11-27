import { z } from "zod";
import { contrastRatio, LAYOUT_PALETTE, layoutForAngle, PALETTES, resolvePalette, splitHeadline, type Layout, type Palette } from "./design";

/**
 * Brand pin template: how the title, handle and logo are laid over each pin
 * image. Pure code, shared by the server compositor and the browser preview.
 */
export const TEMPLATE_STYLES = ["auto", "paper", "framed", "caption", "editorial", "centered", "subtle", "minimal", "elegant", "bold", "none"] as const;
export const TEMPLATE_FONTS = ["sans", "serif", "display"] as const;
export type TemplateStyle = (typeof TEMPLATE_STYLES)[number];
export type TemplateFont = (typeof TEMPLATE_FONTS)[number];

export const STYLE_LABELS: Record<TemplateStyle, string> = {
  auto: "Designer mix: a different layout for each pin (recommended)",
  paper: "Bold top headline",
  framed: "Big number list",
  caption: "Serif headline at the bottom",
  centered: "Centered serif",
  subtle: "Small caption",
  bold: "Bold headline at the bottom",
  minimal: "Minimal fade",
  elegant: "Elegant headline at the top",
  editorial: "Magazine cover headline",
  none: "No text on image",
};
export const FONT_LABELS: Record<TemplateFont, string> = { sans: "Modern sans", serif: "Classic serif", display: "Tall display" };

/** Bundled OFL fonts (public/fonts). Family names must match the font files. */
export const FONT_FAMILY: Record<TemplateFont, string> = { sans: "Poppins", serif: "DM Serif Display", display: "Bebas Neue" };
export const FONT_FILES = [
  "Poppins-Bold.ttf", "Poppins-Medium.ttf", "DMSerifDisplay-Regular.ttf", "BebasNeue-Regular.ttf",
  "PlayfairDisplay-Medium.ttf", "PlayfairDisplay-MediumItalic.ttf", "CormorantGaramond-SemiBold.ttf", "CormorantGaramond-MediumItalic.ttf",
  // Urdu and Arabic headlines (the Latin fonts have no Arabic script; Poppins already covers Hindi).
  "NotoNaskhArabic-Bold.ttf",
];
/** Rough average glyph width as a share of font size, for line wrapping. */
const CHAR_WIDTH: Record<TemplateFont, number> = { sans: 0.6, serif: 0.5, display: 0.42 };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const PinTemplateSchema = z.object({
  style: z.enum(TEMPLATE_STYLES).catch("auto"),
  palette: z.enum(PALETTES).catch("auto"),
  font: z.enum(TEMPLATE_FONTS).catch("serif"),
  primary_color: hex.catch("#b91c1c"),
  text_color: hex.catch("#ffffff"),
  handle: z.string().max(40).catch(""),
  /** Supabase Storage path (live) or a data: URL (demo) of a PNG/JPEG logo. */
  logo: z.string().max(400_000).nullable().catch(null),
});
export type PinTemplate = z.infer<typeof PinTemplateSchema>;

export const DEFAULT_TEMPLATE: PinTemplate = { style: "auto", palette: "auto", font: "serif", primary_color: "#b91c1c", text_color: "#ffffff", handle: "", logo: null };

/** Accepts anything (including old rows with no template) and returns a valid template. */
export function readTemplate(raw: unknown): PinTemplate {
  return PinTemplateSchema.parse({ ...DEFAULT_TEMPLATE, ...(raw && typeof raw === "object" ? raw : {}) });
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Greedy word wrap using an average glyph width. Long single words are kept whole. */
export function wrapLines(text: string, maxWidth: number, fontSize: number, font: TemplateFont): string[] {
  const maxChars = Math.max(4, Math.floor(maxWidth / (fontSize * CHAR_WIDTH[font])));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Picks the largest font size (within bounds) that fits the title in `maxLines`. */
export function fitTitle(title: string, maxWidth: number, font: TemplateFont, scale: number, maxLines = 4, bounds?: { max: number; min: number }) {
  const text = font === "display" ? title.toUpperCase() : title;
  const max = (bounds?.max ?? (font === "display" ? 120 : 84)) * scale;
  const min = (bounds?.min ?? 40) * scale;
  for (let size = max; size >= min; size -= 4 * scale) {
    const lines = wrapLines(text, maxWidth, size, font);
    if (lines.length <= maxLines) return { size, lines };
  }
  const lines = wrapLines(text, maxWidth, min, font);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return { size: min, lines };
}

export interface OverlayInput {
  width: number;
  height: number;
  title: string;
  template: PinTemplate;
  /** data: URL of the logo, already resolved. */
  logoHref?: string | null;
  /** The pin's creative angle: picks the layout in Designer mix. */
  angle?: string;
  /** Dominant colour of the photo (0-1 RGB), for the auto palette. */
  photoColor?: [number, number, number] | null;
  /** Average brightness (0-1) of the photo's top, middle and bottom thirds, so fades are only as dark as needed. */
  tone?: { top: number; middle: number; bottom: number } | null;
}

/** The layout a pin will get with this template. */
export function layoutFor(t: PinTemplate, angle: string | undefined, title: string): Layout | null {
  if (t.style === "auto") return layoutForAngle(angle, title);
  return (["paper", "framed", "caption", "editorial", "centered"] as string[]).includes(t.style) ? (t.style as Layout) : null;
}

/** A transparent SVG (same size as the pin) with the title, handle and logo. */
export function overlaySvg(input: OverlayInput): string {
  const layout = input.title.trim() ? layoutFor(input.template, input.angle, input.title) : null;
  if (layout) return designerSvg(input, layout).svg;
  return classicSvg(input);
}

function classicSvg({ width: W, height: H, title, template: t, logoHref }: OverlayInput): string {
  const s = W / 1000;
  const family = FONT_FAMILY[t.font];
  const weight = t.font === "sans" ? 700 : 400;
  const parts: string[] = [];
  const handleFont = `font-family="Poppins" font-weight="500" font-size="${30 * s}" letter-spacing="${1.5 * s}"`;
  parts.push(
    `<defs><filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${8 * s}" stdDeviation="${14 * s}" flood-color="#000" flood-opacity="0.28"/></filter>` +
      `<filter id="glow" x="-5%" y="-20%" width="110%" height="140%"><feDropShadow dx="0" dy="${2 * s}" stdDeviation="${6 * s}" flood-color="#000" flood-opacity="0.55"/></filter></defs>`,
  );
  if (t.style === "none" || !title.trim()) {
    if (!logoHref) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"/>`;
  } else if (t.style === "subtle") {
    // Small, clean caption on a soft fade at the very bottom: the photo stays the hero.
    const x = 56 * s;
    const { size, lines } = fitTitle(title, W * 0.78, t.font, s, 3, { max: t.font === "display" ? 64 : 50, min: 32 });
    const lh = size * (t.font === "display" ? 1.0 : 1.2);
    const handleH = t.handle ? 44 * s : 0;
    const bottom = H - 56 * s - handleH;
    const first = bottom - (lines.length - 1) * lh;
    const fadeTop = first - size - 140 * s;
    parts.push(
      `<defs><linearGradient id="soft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>`,
      `<rect x="0" y="${fadeTop}" width="${W}" height="${H - fadeTop}" fill="url(#soft)"/>`,
    );
    lines.forEach((l, i) => parts.push(`<text x="${x}" y="${first + i * lh}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}" filter="url(#glow)">${esc(l)}</text>`));
    if (t.handle) parts.push(`<text x="${x}" y="${H - 52 * s}" font-family="Poppins" font-weight="500" font-size="${20 * s}" letter-spacing="${4 * s}" fill="${t.text_color}" fill-opacity="0.8">${esc(t.handle.toUpperCase())}</text>`);
  } else if (t.style === "bold") {
    // Big bold headline straight on the photo's lower half, over a deep fade; brand-colour bar above it.
    const x = 64 * s;
    const { size, lines } = fitTitle(title, W - x * 2, t.font, s * 1.12, 3, { max: t.font === "display" ? 140 : 96, min: 52 });
    const lh = size * (t.font === "display" ? 0.98 : 1.1);
    const bottom = H - (t.handle ? 120 : 80) * s;
    const first = bottom - (lines.length - 1) * lh;
    const fadeTop = first - size - 360 * s;
    parts.push(
      `<defs><linearGradient id="deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.45" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0.88"/></linearGradient></defs>`,
      `<rect x="0" y="${fadeTop}" width="${W}" height="${H - fadeTop}" fill="url(#deep)"/>`,
      `<rect x="${x}" y="${first - size * 0.95 - 30 * s}" width="${110 * s}" height="${12 * s}" rx="${6 * s}" fill="${t.primary_color}"/>`,
    );
    lines.forEach((l, i) => parts.push(`<text x="${x}" y="${first + i * lh}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}" filter="url(#glow)">${esc(l)}</text>`));
    if (t.handle) parts.push(`<text x="${x}" y="${H - 64 * s}" ${handleFont} fill="${t.text_color}" fill-opacity="0.85">${esc(t.handle)}</text>`);
  } else if (t.style === "minimal") {
    const x = 64 * s;
    const { size, lines } = fitTitle(title, W - x * 2, t.font, s);
    const lh = size * (t.font === "display" ? 1.0 : 1.18);
    const handleH = t.handle ? 60 * s : 0;
    const bottom = H - 72 * s - handleH;
    const firstBaseline = bottom - (lines.length - 1) * lh;
    parts.push(
      `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient></defs>`,
      `<rect x="0" y="${H * 0.4}" width="${W}" height="${H * 0.6}" fill="url(#fade)"/>`,
      `<rect x="${x}" y="${firstBaseline - size * 0.95 - 28 * s}" width="${96 * s}" height="${10 * s}" rx="${5 * s}" fill="${t.primary_color}"/>`,
    );
    lines.forEach((l, i) => parts.push(`<text x="${x}" y="${firstBaseline + i * lh}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}" filter="url(#glow)">${esc(l)}</text>`));
    if (t.handle) parts.push(`<text x="${x}" y="${H - 64 * s}" ${handleFont} fill="${t.text_color}" fill-opacity="0.85">${esc(t.handle)}</text>`);
  } else if (t.style === "editorial") {
    // Magazine cover: dark fade from the top, small kicker, big headline, brand-colour rule.
    const x = 64 * s;
    const kicker = t.handle ? t.handle.toUpperCase() : "";
    const top = (kicker ? 150 : 110) * s;
    const { size, lines } = fitTitle(title, W - x * 2, t.font, s * 1.08, 4);
    const lh = size * (t.font === "display" ? 0.98 : 1.12);
    parts.push(
      `<defs><linearGradient id="topfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.82"/><stop offset="0.6" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`,
      `<rect x="0" y="0" width="${W}" height="${top + lines.length * lh + 260 * s}" fill="url(#topfade)"/>`,
    );
    if (kicker) parts.push(`<text x="${x}" y="${96 * s}" font-family="Poppins" font-weight="500" font-size="${26 * s}" letter-spacing="${6 * s}" fill="${t.text_color}" fill-opacity="0.85">${esc(kicker)}</text>`);
    lines.forEach((l, i) =>
      parts.push(`<text x="${x}" y="${top + size * 0.85 + i * lh}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}" filter="url(#glow)">${esc(l)}</text>`),
    );
    parts.push(`<rect x="${x}" y="${top + size * 0.85 + (lines.length - 1) * lh + 34 * s}" width="${120 * s}" height="${8 * s}" rx="${4 * s}" fill="${t.primary_color}"/>`);
  } else {
    // elegant: centred headline straight on the top of the photo, over a soft fade; thin brand-colour rule.
    const pad = 72 * s;
    const { size, lines } = fitTitle(title, W - pad * 2, t.font, s, 3);
    const lh = size * (t.font === "display" ? 1.0 : 1.14);
    const top = 110 * s;
    const last = top + size * 0.9 + (lines.length - 1) * lh;
    parts.push(
      `<defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.78"/><stop offset="0.55" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`,
      `<rect x="0" y="0" width="${W}" height="${last + 320 * s}" fill="url(#top)"/>`,
      `<rect x="${W / 2 - 60 * s}" y="${top - 46 * s}" width="${120 * s}" height="${5 * s}" fill="${t.primary_color}"/>`,
    );
    lines.forEach((l, i) =>
      parts.push(`<text x="${W / 2}" y="${top + size * 0.9 + i * lh}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}" filter="url(#glow)">${esc(l)}</text>`),
    );
    if (t.handle) parts.push(`<text x="${W / 2}" y="${last + 64 * s}" text-anchor="middle" ${handleFont} fill="${t.text_color}" fill-opacity="0.9" filter="url(#glow)">${esc(t.handle)}</text>`);
  }
  if (logoHref) {
    const size = 120 * s;
    const bottom = t.style === "elegant" || t.style === "editorial";
    const x = bottom ? W - size - 48 * s : 48 * s;
    const y = bottom ? H - size - 48 * s : 48 * s;
    parts.push(
      `<rect x="${x - 10 * s}" y="${y - 10 * s}" width="${size + 20 * s}" height="${size + 20 * s}" rx="${22 * s}" fill="#ffffff" fill-opacity="0.92"/>`,
      `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${esc(logoHref)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}


// ---------------------------------------------------------------------------
// Designer mix layouts: serif headline + sans kicker, premium palettes,
// adaptive fades (only as dark as the photo needs), never a heavy box.

const GLYPH: Record<string, number> = { playfair: 0.53, playfairItalic: 0.47, cormorant: 0.44, dmserif: 0.5, poppins: 0.62, poppinsBold: 0.64 };
const FAMILY: Record<string, string> = {
  playfair: "Playfair Display", playfairItalic: "Playfair Display", cormorant: "Cormorant Garamond", dmserif: "DM Serif Display", poppins: "Poppins", poppinsBold: "Poppins",
};

function wrapBy(text: string, maxWidth: number, size: number, glyph: number): string[] {
  const maxChars = Math.max(4, Math.floor(maxWidth / (size * glyph)));
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size that fits in maxLines; avoids a lonely last word (widow) when it can. */
function fitBy(text: string, maxWidth: number, face: string, max: number, min: number, maxLines = 3) {
  const g = GLYPH[face];
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapBy(text, maxWidth, size, g);
    if (lines.length <= maxLines && !(lines.length > 1 && lines[lines.length - 1].split(" ").length === 1 && size > min + 6)) return { size, lines };
  }
  const lines = wrapBy(text, maxWidth, min, g);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return { size: min, lines };
}

/** Kicker text: short, upper-case, letter-spaced. */
function kickerText(k: string, max = 34): string {
  const up = k.toUpperCase();
  return up.length <= max ? up : up.slice(0, max).replace(/\s+\S*$/, "");
}

export interface DesignMeta {
  layout: Layout;
  palette: Palette;
  headline: string;
  headlineSize: number;
  lines: number;
  /** Estimated contrast ratio between the headline and what is behind it. */
  contrast: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Draws one Designer-mix layout. Also returns what it drew, for the design self-check. */
export function designerSvg({ width: W, height: H, title, template: t, logoHref, angle, photoColor, tone }: OverlayInput, layout: Layout): { svg: string; meta: DesignMeta } {
  const s = W / 1000;
  const pal = resolvePalette(t.palette, t.primary_color, photoColor, LAYOUT_PALETTE[layout]);
  const { headline, kicker, number } = splitHeadline(title, angle);
  const tn = { top: 0.5, middle: 0.5, bottom: 0.5, ...(tone ?? {}) };
  const parts: string[] = [];
  const text = (x: number, y: number, str: string, face: string, size: number, fill: string, extra = "") =>
    `<text x="${x}" y="${y}" font-family="${FAMILY[face]}" font-size="${size}" fill="${fill}"${face === "playfairItalic" ? ' font-style="italic"' : ""}${face === "poppins" ? ' font-weight="500"' : face === "poppinsBold" ? ' font-weight="700"' : face === "playfair" || face === "playfairItalic" ? ' font-weight="500"' : face === "cormorant" ? ' font-weight="600"' : ""} ${extra}>${esc(str)}</text>`;
  const kick = (x: number, y: number, str: string, fill: string, anchor = "start", size = 24) =>
    text(x, y, kickerText(str), "poppins", size * s, fill, `letter-spacing="${5 * s}" text-anchor="${anchor}"`);
  // Two shadows: a tight one for crisp edges and a wide one that lifts the text off any photo.
  const heavy = `<filter id="hs" x="-10%" y="-30%" width="120%" height="170%"><feDropShadow dx="0" dy="${2 * s}" stdDeviation="${3 * s}" flood-color="#000" flood-opacity="0.6"/><feDropShadow dx="0" dy="${6 * s}" stdDeviation="${16 * s}" flood-color="#000" flood-opacity="0.45"/></filter>`;
  let headSize = 0;
  let lineCount = 0;
  let contrast = 21;
  const white = "#FFFFFF";

  // Every layout puts the headline straight on the full-bleed photo (no paper band or box):
  // bold type, a pop-colour line, a double drop shadow and a fade only as dark as the photo needs.
  const scrim = (pos: "top" | "bottom" | "middle", y: number, h: number, a: number) => {
    const stops =
      pos === "top"
        ? `<stop offset="0" stop-color="#000" stop-opacity="${a.toFixed(2)}"/><stop offset="0.55" stop-color="#000" stop-opacity="${(a * 0.62).toFixed(2)}"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`
        : pos === "bottom"
          ? `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.45" stop-color="#000" stop-opacity="${(a * 0.62).toFixed(2)}"/><stop offset="1" stop-color="#000" stop-opacity="${a.toFixed(2)}"/>`
          : `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="${a.toFixed(2)}"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`;
    return `<defs>${heavy}<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs><rect x="0" y="${y}" width="${W}" height="${h}" fill="url(#scrim)"/>`;
  };
  /** Headline lines; on two or more lines the last one is in the pop colour (the hook that stops the scroll). */
  const head = (x: number, y: number, lines: string[], lh: number, face: string, size: number, anchor = "start") =>
    lines.map((l, i) => text(x, y + i * lh, l, face, size, lines.length > 1 && i === lines.length - 1 ? pal.pop : white, `text-anchor="${anchor}" filter="url(#hs)"`)).join("");
  const darkness = (l: number, min: number) => clamp(0.55 + (l - 0.3) * 0.9, min, 0.9);
  const handleText = (x: number, y: number, anchor: string) => (t.handle ? kick(x, y, t.handle, white, anchor, 19).replace("<text", '<text fill-opacity="0.9" filter="url(#hs)"') : "");

  if (layout === "paper" || layout === "editorial") {
    // Headline over the top of the photo. paper (how-to): big bold sans, centred. editorial: serif, left.
    const centred = layout === "paper";
    const face = centred ? "poppinsBold" : "dmserif";
    const x = centred ? W / 2 : 68 * s;
    const anchor = centred ? "middle" : "start";
    const fit = fitBy(headline, W - 68 * s * 2, face, (centred ? 98 : 108) * s, (centred ? 58 : 62) * s, 3);
    const lh = fit.size * (centred ? 1.1 : 1.06);
    let y = 92 * s;
    const kickLine = kicker ? kick(x, y, kicker, pal.pop, anchor, 28).replace("<text", '<text filter="url(#hs)"') : "";
    if (kicker) y += 50 * s;
    const first = y + fit.size * 0.9;
    const last = first + (fit.lines.length - 1) * lh;
    const a = darkness(tn.top, 0.62);
    parts.push(scrim("top", 0, last + 330 * s, a), kickLine, head(x, first, fit.lines, lh, face, fit.size, anchor));
    parts.push(`<rect x="${centred ? W / 2 - 42 * s : x}" y="${last + 34 * s}" width="${84 * s}" height="${6 * s}" rx="${3 * s}" fill="${pal.pop}"/>`);
    parts.push(handleText(centred ? W / 2 : W - x, H - 52 * s, centred ? "middle" : "end"));
    headSize = fit.size;
    lineCount = fit.lines.length;
    contrast = contrastRatio(1, tn.top * (1 - a) * 0.9);
  } else if (layout === "framed" || layout === "caption") {
    // Headline over the bottom of the photo. framed (lists): huge pop-colour number + bold sans. caption: big serif.
    const list = layout === "framed";
    const face = list ? "poppinsBold" : "dmserif";
    const x = 68 * s;
    const fit = fitBy(number && list ? headline.replace(/^\d+\s+/, "") : headline, W - x * 2, face, (list ? 92 : 104) * s, (list ? 56 : 60) * s, 3);
    const lh = fit.size * (list ? 1.1 : 1.06);
    const bottom = H - (t.handle ? 118 : 80) * s;
    const first = bottom - (fit.lines.length - 1) * lh;
    let top = first - fit.size * 0.9;
    if (kicker) {
      parts.push(kick(x, top - 24 * s, kicker, pal.pop, "start", 28).replace("<text", '<text filter="url(#hs)"'));
      top -= 64 * s;
    }
    if (number && list) {
      const numSize = 230 * s;
      parts.push(text(x - 6 * s, top - 18 * s, number, "poppinsBold", numSize, pal.pop, 'filter="url(#hs)"'));
      top -= numSize * 0.78;
    }
    const a = darkness(tn.bottom, 0.62);
    const fadeTop = Math.max(0, top - 260 * s);
    parts.splice(0, 0, scrim("bottom", fadeTop, H - fadeTop, a));
    parts.push(head(x, first, fit.lines, lh, face, fit.size));
    parts.push(handleText(x, H - 62 * s, "start"));
    headSize = fit.size;
    lineCount = fit.lines.length;
    contrast = contrastRatio(1, tn.bottom * (1 - a) * 0.9);
  } else {
    // centered: a soft horizontal veil across the lower middle; hairlines around the kicker; italic serif headline.
    const padX = 76 * s;
    const fit = fitBy(headline, W - padX * 2, "playfairItalic", 96 * s, 58 * s, 3);
    const lh = fit.size * 1.1;
    const blockH = (kicker ? 60 * s : 0) + fit.size * 0.9 + (fit.lines.length - 1) * lh + (t.handle ? 64 * s : 0);
    const cy = H * 0.62;
    const top = cy - blockH / 2;
    const a = darkness(tn.middle, 0.6);
    parts.push(scrim("middle", cy - (blockH + 460 * s) / 2, blockH + 460 * s, a));
    let y = top;
    if (kicker) {
      const kw = kickerText(kicker).length * 26 * s * 0.62 + kickerText(kicker).length * 5 * s;
      parts.push(
        kick(W / 2, y + 22 * s, kicker, pal.pop, "middle", 28).replace("<text", '<text filter="url(#hs)"'),
        `<rect x="${W / 2 - kw / 2 - 70 * s}" y="${y + 13 * s}" width="${50 * s}" height="${2 * s}" fill="${pal.pop}"/>`,
        `<rect x="${W / 2 + kw / 2 + 20 * s}" y="${y + 13 * s}" width="${50 * s}" height="${2 * s}" fill="${pal.pop}"/>`,
      );
      y += 60 * s;
    }
    parts.push(head(W / 2, y + fit.size * 0.9, fit.lines, lh, "playfairItalic", fit.size, "middle"));
    parts.push(handleText(W / 2, y + fit.size * 0.9 + (fit.lines.length - 1) * lh + 60 * s, "middle"));
    headSize = fit.size;
    lineCount = fit.lines.length;
    contrast = contrastRatio(1, tn.middle * (1 - a) * 0.9);
  }
  if (logoHref) {
    const size = 96 * s;
    const atTop = layout === "caption" || layout === "centered" || layout === "framed";
    const x = layout === "framed" ? 60 * s : W - size - 52 * s;
    const y = atTop ? (layout === "framed" ? 60 * s : 52 * s) : H - size - 52 * s;
    parts.push(
      `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2 + 10 * s}" fill="${pal.paper}" fill-opacity="0.92"/>`,
      `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${esc(logoHref)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  // Layout-specific ids, so several previews on one page don't share gradients.
  const body = parts.join("").replace(/id="(\w+)"/g, `id="$1-${layout}"`).replace(/url\(#(\w+)\)/g, `url(#$1-${layout})`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  return { svg, meta: { layout, palette: pal, headline, headlineSize: headSize / s, lines: lineCount, contrast } };
}
