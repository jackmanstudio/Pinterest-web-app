import "server-only";
import { DemoImageProvider } from "./demo";
import type { ImageProvider } from "./types";

/**
 * Picks the image provider from server env. No real provider is wired yet:
 * until IMAGE_AI_PROVIDER names a supported adapter, the labelled demo
 * placeholder is used. Add adapters here (e.g. "openai", "google").
 */
export function getImageProvider(env: Record<string, string | undefined> = process.env): ImageProvider {
  const provider = (env.IMAGE_AI_PROVIDER || "").toLowerCase();
  if (!provider || !env.IMAGE_AI_API_KEY) return new DemoImageProvider();
  throw new Error(`IMAGE_AI_PROVIDER "${provider}" is not implemented yet`);
}
