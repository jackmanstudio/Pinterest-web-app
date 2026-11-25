import "server-only";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { FONT_FILES, overlaySvg, type PinTemplate } from "./template";

const fontFiles = () => FONT_FILES.map((f) => path.join(process.cwd(), "public", "fonts", f));

export interface ComposeInput {
  base: Uint8Array;
  title: string;
  template: PinTemplate;
  logo?: { bytes: Uint8Array; contentType: string } | null;
  size: { width: number; height: number };
  quality?: number;
}

/** Crops the base image to the pin size and draws the brand overlay on top. Returns a JPEG. */
export async function composePin({ base, title, template, logo, size, quality = 88 }: ComposeInput): Promise<{ bytes: Uint8Array; contentType: "image/jpeg"; extension: "jpg" }> {
  const { width: W, height: H } = size;
  const resized = await sharp(Buffer.from(base), { density: 144 }).resize(W, H, { fit: "cover", position: "attention" }).toBuffer();
  const logoHref = logo ? `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}` : null;
  const svg = overlaySvg({ width: W, height: H, title, template, logoHref });
  const overlay = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "Poppins" },
  })
    .render()
    .asPng();
  const out = await sharp(resized).composite([{ input: overlay }]).jpeg({ quality, mozjpeg: true }).toBuffer();
  return { bytes: new Uint8Array(out), contentType: "image/jpeg", extension: "jpg" };
}
