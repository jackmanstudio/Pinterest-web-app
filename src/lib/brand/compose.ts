import "server-only";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { designReport, type DesignReport, type PhotoStats } from "./check";
import { paletteForColor, PALETTE_COLORS } from "./design";
import { designerSvg, FONT_FILES, layoutFor, overlaySvg, type PinTemplate } from "./template";

const fontFiles = () => FONT_FILES.map((f) => path.join(process.cwd(), "public", "fonts", f));

export interface ComposeInput {
  base: Uint8Array;
  title: string;
  template: PinTemplate;
  logo?: { bytes: Uint8Array; contentType: string } | null;
  size: { width: number; height: number };
  quality?: number;
  /** The pin's creative angle (picks the Designer-mix layout). */
  angle?: string;
  /** A real photo from the user's page (often a model): keep text off the top so faces stay visible. */
  pagePhoto?: boolean;
}

/** Layouts that put the headline over the top or middle of the photo, and their bottom-text stand-ins. */
const PHOTO_SAFE: Partial<Record<string, "caption" | "framed">> = { paper: "caption", centered: "framed" };

/** Measures the photo: sharpness, brightness, saturation, clipping, dominant colour and brightness per third. */
export async function measurePhoto(img: Buffer): Promise<{ stats: PhotoStats; color: [number, number, number]; tone: { top: number; middle: number; bottom: number } }> {
  const small = await sharp(img).resize(60, 90, { fit: "fill" }).removeAlpha().raw().toBuffer();
  let sat = 0;
  let lum = 0;
  let clip = 0;
  const thirds = [0, 0, 0];
  const px = small.length / 3;
  for (let i = 0; i < px; i++) {
    const r = small[i * 3] / 255;
    const g = small[i * 3 + 1] / 255;
    const b = small[i * 3 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    lum += y;
    if (y > 0.97 || y < 0.03) clip++;
    thirds[Math.min(2, Math.floor(Math.floor(i / 60) / 30))] += y;
  }
  const lap = await sharp(img)
    .resize(400)
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .stats();
  const st = await sharp(img).stats();
  return {
    stats: { sharpness: lap.channels[0].stdev, brightness: lum / px, saturation: sat / px, clipped: clip / px },
    color: [st.dominant.r / 255, st.dominant.g / 255, st.dominant.b / 255],
    tone: { top: thirds[0] / (px / 3), middle: thirds[1] / (px / 3), bottom: thirds[2] / (px / 3) },
  };
}

/** Crops the base image to the pin size, draws the design on top and self-checks it. Returns a JPEG. */
export async function composePin({ base, title, template, logo, size, quality = 88, angle, pagePhoto }: ComposeInput): Promise<{
  bytes: Uint8Array;
  contentType: "image/jpeg";
  extension: "jpg";
  design: DesignReport;
}> {
  const { width: W, height: H } = size;
  const resized = await sharp(Buffer.from(base), { density: 144 }).resize(W, H, { fit: "cover", position: "attention" }).toBuffer();
  const logoHref = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : null;
  const measured = await measurePhoto(resized).catch(() => null);
  const picked = title.trim() ? layoutFor(template, angle, title) : null;
  const layout = picked && pagePhoto && template.style === "auto" ? (PHOTO_SAFE[picked] ?? picked) : picked;
  const input = { width: W, height: H, title, template, logoHref, angle, photoColor: measured?.color ?? null, tone: measured?.tone ?? null };
  const drawn = layout ? designerSvg(input, layout) : null;
  const svg = drawn ? drawn.svg : overlaySvg(input);
  const overlay = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Poppins" },
  })
    .render()
    .asPng();
  const out = await sharp(resized).composite([{ input: overlay }]).jpeg({ quality, mozjpeg: true }).toBuffer();
  const paletteName =
    template.palette === "auto" && measured ? paletteForColor(measured.color) : template.palette === "auto" ? "auto" : template.palette;
  const design = designReport(measured?.stats ?? null, drawn?.meta ?? null, { paletteName: paletteName in PALETTE_COLORS || paletteName === "brand" ? paletteName : undefined });
  return { bytes: new Uint8Array(out), contentType: "image/jpeg", extension: "jpg", design };
}
