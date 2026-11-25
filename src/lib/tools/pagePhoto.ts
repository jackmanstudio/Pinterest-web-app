import "server-only";
import sharp from "sharp";
import type { GeneratedImage } from "@/lib/ai/image/types";
import { FetchBlocked, safeFetch } from "./safeFetch";

export class PhotoError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([403, 404, 408, 425, 429, 500, 502, 503, 504]);

/**
 * Downloads a page photo safely and checks it is a real, big-enough image.
 * Store CDNs often refuse a burst of requests or bot-looking ones, so it asks
 * like a browser (with the page as referer) and retries a few times.
 */
export async function pagePhoto(url: string, opts: { referer?: string; fetchImpl?: typeof fetch; waitMs?: number } = {}): Promise<GeneratedImage> {
  let r;
  const wait = opts.waitMs ?? 700;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await safeFetch(url, {
        accept: "image/avif,image/webp,image/jpeg,image/png,image/*", maxBytes: 12_000_000, timeoutMs: 15_000,
        browserLike: true, referer: opts.referer, fetchImpl: opts.fetchImpl,
      });
    } catch (e) {
      if (e instanceof FetchBlocked) throw new PhotoError(e.message);
      if (attempt < 2) {
        await sleep(wait * (attempt + 1));
        continue;
      }
      throw new PhotoError("Couldn't download that photo.");
    }
    if (r.status < 400 || !TRANSIENT.has(r.status) || attempt >= 2) break;
    await sleep(wait * (attempt + 1) + Math.random() * 300);
  }
  if (r.status >= 400) throw new PhotoError(`The photo couldn't be downloaded (${r.status}).`);
  const meta = await sharp(r.bytes).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw new PhotoError("That link isn't a supported image.");
  if (Math.min(meta.width, meta.height) < 300) throw new PhotoError("That photo is too small for a pin (under 300 px).");
  return { bytes: r.bytes, contentType: `image/${meta.format}`, extension: "jpg", source: "manual", provider: "Photo from your page", model: null, est_cost_usd: 0 };
}
