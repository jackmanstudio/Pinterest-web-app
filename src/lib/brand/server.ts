import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET, PIN_IMAGE_SIZE, type GeneratedImage } from "@/lib/ai/image/types";
import { composePin } from "./compose";
import { readTemplate, type PinTemplate } from "./template";

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
export async function brandPinImage(img: GeneratedImage, title: string, art: BrandArt, opts: { demo?: boolean } = {}): Promise<GeneratedImage> {
  const size = opts.demo ? { width: 600, height: 900 } : PIN_IMAGE_SIZE;
  const out = await composePin({ base: img.bytes, title, template: art.template, logo: art.logo, size, quality: opts.demo ? 72 : 88 });
  return { ...img, ...out };
}
