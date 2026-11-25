import { ProviderError } from "@/lib/ai/text/types";
import type { GeneratedImage, ImageProvider } from "./types";

export type ImageQuality = "low" | "medium" | "high";

/**
 * Estimated USD per portrait (1024x1536) image. Estimates only, used for the
 * budget cap: check OpenAI's pricing page and override with
 * IMAGE_AI_COST_PER_IMAGE_USD if it differs.
 */
export const OPENAI_IMAGE_COST: Record<ImageQuality, number> = { low: 0.02, medium: 0.07, high: 0.25 };

interface Options {
  apiKey: string;
  model?: string;
  quality?: ImageQuality;
  costPerImage?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** OpenAI GPT Image adapter (POST /v1/images/generations). Server-side only. */
export class OpenAIImageProvider implements ImageProvider {
  readonly source = "ai" as const;
  readonly name: string;
  private readonly model: string;
  private readonly quality: ImageQuality;
  private readonly cost: number;

  constructor(private readonly opts: Options) {
    this.model = opts.model || "gpt-image-1.5";
    this.quality = opts.quality ?? "medium";
    this.cost = opts.costPerImage ?? OPENAI_IMAGE_COST[this.quality];
    this.name = `OpenAI ${this.model}`;
  }

  async generate(prompt: string): Promise<GeneratedImage> {
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl ?? "https://api.openai.com"}/v1/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          size: "1024x1536",
          quality: this.quality,
          output_format: "jpeg",
          n: 1,
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new ProviderError(`Image provider unreachable: ${(e as Error).message}`, 502, true);
    }
    const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } } | null;
    if (!res.ok) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) throw new ProviderError("Image AI key was rejected. Check IMAGE_AI_API_KEY on the server.", 502, false);
      if (res.status === 400 && /safety|policy|moderation/i.test(msg + (body?.error?.code ?? "")))
        throw new ProviderError("The image request was blocked by the provider's safety filter. Edit the image prompt and try again.", 422, false);
      if (res.status === 403) throw new ProviderError(`Image AI access denied (your OpenAI organization may need verification for GPT Image): ${msg}`, 502, false);
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`Image generation failed: ${msg}`, retryable ? 503 : 502, retryable);
    }
    const b64 = body?.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("Image provider returned no image", 502, true);
    return {
      bytes: new Uint8Array(Buffer.from(b64, "base64")),
      contentType: "image/jpeg",
      extension: "jpg",
      source: "ai",
      provider: this.name,
      model: this.model,
      est_cost_usd: this.cost,
    };
  }
}
