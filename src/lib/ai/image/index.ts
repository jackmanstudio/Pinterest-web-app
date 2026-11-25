import "server-only";
import { CloudflareImageProvider } from "./cloudflare";
import { DemoImageProvider } from "./demo";
import { OpenAIImageProvider, type ImageQuality } from "./openai";
import type { ImageProvider } from "./types";

type Env = Record<string, string | undefined>;

function costOverride(env: Env): number | undefined {
  const v = env.IMAGE_AI_COST_PER_IMAGE_USD;
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Picks the image provider from server env:
 * - "cloudflare" (free tier): CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 * - "openai" (paid, highest quality): IMAGE_AI_API_KEY or OPENAI_API_KEY
 * With no IMAGE_AI_PROVIDER, the first one with credentials wins (Cloudflare,
 * then OpenAI). With none, the labelled demo placeholder is used.
 */
export function getImageProvider(env: Env = process.env): ImageProvider {
  const cf = env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN;
  const openaiKey = env.IMAGE_AI_API_KEY || env.OPENAI_API_KEY;
  const provider = (env.IMAGE_AI_PROVIDER || (cf ? "cloudflare" : openaiKey ? "openai" : "demo")).toLowerCase();

  if (provider === "demo") return new DemoImageProvider();
  if (provider === "cloudflare") {
    if (!cf) return new DemoImageProvider();
    return new CloudflareImageProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID!, apiToken: env.CLOUDFLARE_API_TOKEN!, model: env.IMAGE_AI_MODEL || undefined, costPerImage: costOverride(env) });
  }
  if (provider === "openai") {
    if (!openaiKey) return new DemoImageProvider();
    const q = (env.IMAGE_AI_QUALITY || "medium").toLowerCase();
    return new OpenAIImageProvider({
      apiKey: openaiKey,
      model: env.IMAGE_AI_MODEL || undefined,
      quality: (["low", "medium", "high"].includes(q) ? q : "medium") as ImageQuality,
      costPerImage: costOverride(env),
    });
  }
  throw new Error(`IMAGE_AI_PROVIDER "${provider}" is not supported. Use "cloudflare", "openai" or "demo".`);
}
