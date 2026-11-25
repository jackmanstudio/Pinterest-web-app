import { ProviderError } from "@/lib/ai/text/types";
import type { GeneratedImage, ImageProvider } from "./types";

/** 2:3 portrait; both sides are multiples of 16 and inside the model's 256–1920 range. */
export const CLOUDFLARE_PIN_SIZE = { width: 768, height: 1152 } as const;

interface Options {
  accountId: string;
  apiToken: string;
  model?: string;
  costPerImage?: number;
  fetchImpl?: typeof fetch;
}

function sniff(bytes: Uint8Array): { contentType: string; extension: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { contentType: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { contentType: "image/jpeg", extension: "jpg" };
  throw new ProviderError("Image provider returned an unsupported image format", 502, true);
}

/**
 * Cloudflare Workers AI adapter, default model FLUX.2 [klein] 4B (commercial use
 * allowed; Workers AI's free daily allocation covers roughly 60 pin images).
 * REST: POST /accounts/{id}/ai/run/{model} with multipart form fields.
 */
export class CloudflareImageProvider implements ImageProvider {
  readonly source = "ai" as const;
  readonly name: string;
  private readonly model: string;
  private readonly cost: number;

  constructor(private readonly opts: Options) {
    this.model = opts.model || "@cf/black-forest-labs/flux-2-klein-4b";
    this.cost = opts.costPerImage ?? 0;
    this.name = `Cloudflare ${this.model.replace(/^@cf\/[^/]+\//, "")}`;
  }

  async generate(prompt: string): Promise<GeneratedImage> {
    const f = this.opts.fetchImpl ?? fetch;
    const form = new FormData();
    form.set("prompt", prompt);
    form.set("width", String(CLOUDFLARE_PIN_SIZE.width));
    form.set("height", String(CLOUDFLARE_PIN_SIZE.height));
    let res: Response;
    try {
      res = await f(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.opts.accountId)}/ai/run/${this.model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiToken}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new ProviderError(`Image provider unreachable: ${(e as Error).message}`, 502, true);
    }
    const body = (await res.json().catch(() => null)) as { success?: boolean; result?: { image?: string }; errors?: { message?: string; code?: number }[] } | null;
    if (!res.ok || body?.success === false) {
      const msg = body?.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new ProviderError(`Cloudflare rejected the credentials. Check CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (needs Workers AI permission). ${msg}`, 502, false);
      if (res.status === 429 || /neuron|limit|quota/i.test(msg)) throw new ProviderError(`Cloudflare's daily free image limit was reached; it resets daily. (${msg})`, 429, false);
      const retryable = res.status >= 500;
      throw new ProviderError(`Image generation failed: ${msg}`, retryable ? 503 : 502, retryable);
    }
    const b64 = body?.result?.image;
    if (!b64) throw new ProviderError("Image provider returned no image", 502, true);
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    return { bytes, ...sniff(bytes), source: "ai", provider: this.name, model: this.model, est_cost_usd: this.cost };
  }
}
