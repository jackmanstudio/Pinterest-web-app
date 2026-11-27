import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET, PIN_IMAGE_SIZE, type GeneratedImage } from "@/lib/ai/image/types";
import { composePin } from "./compose";
import { readTemplate, type PinTemplate } from "./template";
import type { DesignReport } from "./check";

export interface BrandArt {
  template: PinTemplate;
  logo: { bytes: Uint8Array; contentType: string } | null;
}

const MAX_LOGO_BYTES = 300_000;

/** Decodes a PNG/JPEG data: URL logo (demo mode). Anything else is ignored. */
export function logoFromDataUrl(url: string | null | undefined): BrandArt["logo"] {
  const m = url ? /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(url) : null;
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  return bytes.length <= MAX_LOGO_BYTES ? { bytes, contentType: m[1] } : null;
}

/** Loads a workspace's pin template and logo (logo must live in that workspace's storage folder). */
export async function brandArtFor(db: SupabaseClient, workspaceId: string): Promise<BrandArt> {
  const { data } = await db.from("brand_settings").select("pin_template").eq("workspace_id", workspaceId).maybeSingle();
  const template = readTemplate(data?.pin_template);
  let logo: BrandArt["logo"] = null;
  if (template.logo?.startsWith(`${workspaceId}/`)) {
    const dl = await db.storage.from(IMAGE_BUCKET).download(template.logo);
    if (dl.data && dl.data.size <= MAX_LOGO_BYTES) logo = { bytes: new Uint8Array(await dl.data.arrayBuffer()), contentType: dl.data.type || "image/png" };
  }
  return { template, logo };
}

/** Turns a raw generated image into the final branded pin (JPEG at pin size). */
export async function brandPinImage(
  img: GeneratedImage,
  title: string,
  art: BrandArt,
  opts: { demo?: boolean; angle?: string } = {},
): Promise<GeneratedImage & { design: DesignReport }> {
  const size = opts.demo ? { width: 600, height: 900 } : PIN_IMAGE_SIZE;
  const out = await composePin({ base: img.bytes, title, template: art.template, logo: art.logo, size, quality: opts.demo ? 72 : 92, angle: opts.angle, pagePhoto: img.source === "manual" });
  return { ...img, ...out };
}

/**
 * Makes a branded pin and inspects it (sharpness, light, resolution, headline contrast).
 * If the photo fails, one new image is made and the better-scoring pin is kept, so a weak
 * pin is never delivered without a second try. Returns how many images were generated.
 */
/** A second image is only tried when the first took less than this. */
export const REMAKE_WITHIN_MS = 10_000;

export async function bestPinImage(
  generate: () => Promise<GeneratedImage>,
  title: string,
  art: BrandArt,
  opts: { angle?: string } = {},
): Promise<{ image: GeneratedImage & { design: DesignReport }; attempts: number }> {
  const t0 = Date.now();
  const raw = await generate();
  let image = await brandPinImage(raw, title, art, { demo: raw.source === "demo", angle: opts.angle });
  // Speed first: remake only a clearly broken photo (blurry or badly lit), and only when the first one
  // came back fast, so a pin never waits for two slow generations.
  const broken = image.design.checks.some((c) => (c.id === "sharp" || c.id === "exposure") && c.status === "fail");
  if (raw.source !== "ai" || !broken || Date.now() - t0 > REMAKE_WITHIN_MS) return { image, attempts: 1 };
  const second = await generate()
    .then((r) => brandPinImage(r, title, art, { angle: opts.angle }))
    .catch(() => null);
  if (second && second.design.score > image.design.score) image = second;
  return { image, attempts: second ? 2 : 1 };
}
