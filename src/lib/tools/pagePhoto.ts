import "server-only";
import sharp from "sharp";
import type { GeneratedImage } from "@/lib/ai/image/types";
import { FetchBlocked, safeFetch } from "./safeFetch";

export class PhotoError extends Error {}

/** Downloads a page photo safely and checks it is a real, big-enough image. */
export async function pagePhoto(url: string): Promise<GeneratedImage> {
  let r;
  try {
    r = await safeFetch(url, { accept: "image/avif,image/webp,image/jpeg,image/png,image/*", maxBytes: 12_000_000, timeoutMs: 15_000 });
  } catch (e) {
    throw new PhotoError(e instanceof FetchBlocked ? e.message : "Couldn't download that photo.");
  }
  if (r.status >= 400) throw new PhotoError(`The photo couldn't be downloaded (${r.status}).`);
  const meta = await sharp(r.bytes).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new PhotoError("That link isn't a supported image.");
  if (Math.min(meta.width, meta.height) < 300) throw new PhotoError("That photo is too small for a pin (under 300 px).");
  return { bytes: r.bytes, contentType: `image/${meta.format}`, extension: "jpg", source: "manual", provider: "Photo from your page", model: null, est_cost_usd: 0 };
}
