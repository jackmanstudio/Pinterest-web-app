import { ProviderError } from "@/lib/ai/text/types";
import { pinImagePrompt } from "./openai";
import type { GeneratedImage, ImageProvider } from "./types";

export const FAL_DEFAULT_MODEL = "blackforestlabs/flux-3/klein/text-to-image";

/** Estimated USD per 2:3 pin image (fal list prices, Nov 2026). Override with IMAGE_AI_COST_PER_IMAGE_USD. */
export function falCost(model: string): number {
  if (model.includes("flux-3/klein")) return 0.011;
  if (model.includes("nano-banana")) return 0.067;
  return 0.07;
}

interface Options {
  apiKey: string;
  model?: string;
  costPerImage?: number;
  fetchImpl?: typeof fetch;
}

/**
 * fal.ai adapter (recommended paid option: good quality at low cost).
 * Default FLUX.3 Klein at 1024x1536. POST https://fal.run/{model}, `Authorization: Key …`.
 */
export class FalImageProvider implements ImageProvider {
  readonly source = "ai" as const;
  readonly name: string;
  private readonly model: string;
  private readonly cost: number;

  constructor(private readonly opts: Options) {
    this.model = opts.model || FAL_DEFAULT_MODEL;
    this.cost = opts.costPerImage ?? falCost(this.model);
    this.name = `fal ${this.model.replace(/\/text-to-image$/, "")}`;
  }

  async generate(prompt: string): Promise<GeneratedImage> {
    const f = this.opts.fetchImpl ?? fetch;
    const body: Record<string, unknown> = { prompt: pinImagePrompt(prompt), num_images: 1, output_format: "jpeg", sync_mode: true };
    // Nano Banana takes an aspect ratio; FLUX models take an explicit size.
    if (this.model.includes("nano-banana")) body.aspect_ratio = "2:3";
    else body.image_size = { width: 1024, height: 1536 };
    let res: Response;
    try {
      res = await f(`https://fal.run/${this.model}`, {
        method: "POST",
        headers: { Authorization: `Key ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new ProviderError(`Image provider unreachable: ${(e as Error).message}`, 502, true);
    }
    const data = (await res.json().catch(() => null)) as { images?: { url?: string; content_type?: string }[]; detail?: unknown; has_nsfw_concepts?: boolean[] } | null;
    if (!res.ok) {
      const msg = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? `HTTP ${res.status}`).slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new ProviderError("fal.ai rejected the key. Check FAL_KEY on the server.", 502, false);
      if (res.status === 402 || /balance|credit/i.test(msg)) throw new ProviderError("fal.ai account has no credit left. Top up at fal.ai/dashboard/billing.", 402, false);
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`Image generation failed: ${msg}`, retryable ? 503 : 502, retryable);
    }
    if (data?.has_nsfw_concepts?.[0]) throw new ProviderError("The image was blocked by the provider's safety filter. Edit the image prompt and try again.", 422, false);
    const url = data?.images?.[0]?.url;
    if (!url) throw new ProviderError("Image provider returned no image", 502, true);
    let bytes: Uint8Array;
    let contentType = data?.images?.[0]?.content_type || "image/jpeg";
    if (url.startsWith("data:")) {
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
      if (!m) throw new ProviderError("Image provider returned an unreadable image", 502, true);
      contentType = m[1] || contentType;
      bytes = new Uint8Array(Buffer.from(m[3], m[2] ? "base64" : "utf8"));
    } else {
      const img = await f(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!img?.ok) throw new ProviderError("Could not download the generated image", 502, true);
      bytes = new Uint8Array(await img.arrayBuffer());
      contentType = img.headers.get("content-type") || contentType;
    }
    const png = contentType.includes("png");
    return { bytes, contentType: png ? "image/png" : "image/jpeg", extension: png ? "png" : "jpg", source: "ai", provider: this.name, model: this.model, est_cost_usd: this.cost };
  }
}
