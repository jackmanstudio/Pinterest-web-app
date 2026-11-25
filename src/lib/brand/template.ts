import { z } from "zod";

/**
 * Brand pin template: how the title, handle and logo are laid over each pin
 * image. Pure code, shared by the server compositor and the browser preview.
 */
export const TEMPLATE_STYLES = ["bold", "minimal", "elegant", "none"] as const;
export const TEMPLATE_FONTS = ["sans", "serif", "display"] as const;
export type TemplateStyle = (typeof TEMPLATE_STYLES)[number];
export type TemplateFont = (typeof TEMPLATE_FONTS)[number];

export const STYLE_LABELS: Record<TemplateStyle, string> = {
  bold: "Bold band",
  minimal: "Minimal fade",
  elegant: "Elegant card",
  none: "No text on image",
};
export const FONT_LABELS: Record<TemplateFont, string> = { sans: "Modern sans", serif: "Classic serif", display: "Tall display" };

/** Bundled OFL fonts (public/fonts). Family names must match the font files. */
export const FONT_FAMILY: Record<TemplateFont, string> = { sans: "Poppins", serif: "DM Serif Display", display: "Bebas Neue" };
export const FONT_FILES = ["Poppins-Bold.ttf", "Poppins-Medium.ttf", "DMSerifDisplay-Regular.ttf", "BebasNeue-Regular.ttf"];
/** Rough average glyph width as a share of font size, for line wrapping. */
const CHAR_WIDTH: Record<TemplateFont, number> = { sans: 0.6, serif: 0.5, display: 0.42 };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const PinTemplateSchema = z.object({
  style: z.enum(TEMPLATE_STYLES).catch("bold"),
  font: z.enum(TEMPLATE_FONTS).catch("sans"),
  primary_color: hex.catch("#b91c1c"),
  text_color: hex.catch("#ffffff"),
  handle: z.string().max(40).catch(""),
  /** Supabase Storage path (live) or a data: URL (demo) of a PNG/JPEG logo. */
  logo: z.string().max(400_000).nullable().catch(null),
});
export type PinTemplate = z.infer<typeof PinTemplateSchema>;

export const DEFAULT_TEMPLATE: PinTemplate = { style: "bold", font: "sans", primary_color: "#b91c1c", text_color: "#ffffff", handle: "", logo: null };

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
export function fitTitle(title: string, maxWidth: number, font: TemplateFont, scale: number, maxLines = 4) {
  const text = font === "display" ? title.toUpperCase() : title;
  const max = (font === "display" ? 120 : 84) * scale;
  const min = 40 * scale;
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
}

/** A transparent SVG (same size as the pin) with the title, handle and logo. */
export function overlaySvg({ width: W, height: H, title, template: t, logoHref }: OverlayInput): string {
  const s = W / 1000;
  const family = FONT_FAMILY[t.font];
  const weight = t.font === "sans" ? 700 : 400;
  const parts: string[] = [];
  const handleFont = `font-family="Poppins" font-weight="500" font-size="${30 * s}"`;
  if (t.style === "none" || !title.trim()) {
    if (!logoHref) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"/>`;
  } else if (t.style === "bold") {
    const pad = 48 * s;
    const { size, lines } = fitTitle(title, W - 80 * s - pad * 2, t.font, s);
    const lh = size * (t.font === "display" ? 1.0 : 1.18);
    const handleH = t.handle ? 52 * s : 0;
    const blockH = pad * 2 + lines.length * lh + handleH;
    const top = H - 40 * s - blockH;
    parts.push(`<rect x="${40 * s}" y="${top}" width="${W - 80 * s}" height="${blockH}" rx="${28 * s}" fill="${t.primary_color}" fill-opacity="0.94"/>`);
    lines.forEach((l, i) =>
      parts.push(`<text x="${W / 2}" y="${top + pad + size * 0.85 + i * lh}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}">${esc(l)}</text>`),
    );
    if (t.handle) parts.push(`<text x="${W / 2}" y="${top + blockH - pad + 4 * s}" text-anchor="middle" ${handleFont} fill="${t.text_color}" fill-opacity="0.85">${esc(t.handle)}</text>`);
  } else if (t.style === "minimal") {
    const x = 64 * s;
    const { size, lines } = fitTitle(title, W - x * 2, t.font, s);
    const lh = size * (t.font === "display" ? 1.0 : 1.18);
    const handleH = t.handle ? 60 * s : 0;
    const bottom = H - 72 * s - handleH;
    const firstBaseline = bottom - (lines.length - 1) * lh;
    parts.push(
      `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient></defs>`,
      `<rect x="0" y="${H * 0.42}" width="${W}" height="${H * 0.58}" fill="url(#fade)"/>`,
      `<rect x="${x}" y="${firstBaseline - size * 0.95 - 28 * s}" width="${96 * s}" height="${10 * s}" rx="${5 * s}" fill="${t.primary_color}"/>`,
    );
    lines.forEach((l, i) => parts.push(`<text x="${x}" y="${firstBaseline + i * lh}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${t.text_color}">${esc(l)}</text>`));
    if (t.handle) parts.push(`<text x="${x}" y="${H - 64 * s}" ${handleFont} fill="${t.text_color}" fill-opacity="0.85">${esc(t.handle)}</text>`);
  } else {
    // elegant: light card near the top, dark text, thin brand-colour rule.
    const pad = 52 * s;
    const cardX = 72 * s;
    const { size, lines } = fitTitle(title, W - cardX * 2 - pad * 2, t.font, s);
    const lh = size * (t.font === "display" ? 1.0 : 1.2);
    const handleH = t.handle ? 54 * s : 0;
    const cardH = pad * 2 + 22 * s + lines.length * lh + handleH;
    const top = 96 * s;
    const ink = t.text_color.toLowerCase() === "#ffffff" ? "#1c1917" : t.text_color;
    parts.push(
      `<rect x="${cardX}" y="${top}" width="${W - cardX * 2}" height="${cardH}" rx="${10 * s}" fill="#ffffff" fill-opacity="0.93"/>`,
      `<rect x="${W / 2 - 60 * s}" y="${top + pad}" width="${120 * s}" height="${5 * s}" fill="${t.primary_color}"/>`,
    );
    lines.forEach((l, i) =>
      parts.push(`<text x="${W / 2}" y="${top + pad + 22 * s + size * 0.9 + i * lh}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${ink}">${esc(l)}</text>`),
    );
    if (t.handle) parts.push(`<text x="${W / 2}" y="${top + cardH - pad + 8 * s}" text-anchor="middle" ${handleFont} fill="${t.primary_color}">${esc(t.handle)}</text>`);
  }
  if (logoHref) {
    const size = 120 * s;
    const x = t.style === "elegant" ? W - size - 48 * s : 48 * s;
    const y = t.style === "elegant" ? H - size - 48 * s : 48 * s;
    parts.push(
      `<rect x="${x - 10 * s}" y="${y - 10 * s}" width="${size + 20 * s}" height="${size + 20 * s}" rx="${22 * s}" fill="#ffffff" fill-opacity="0.92"/>`,
      `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${esc(logoHref)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}
