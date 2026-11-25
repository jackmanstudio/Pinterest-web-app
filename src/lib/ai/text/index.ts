import "server-only";
import { AnthropicTextProvider } from "./anthropic";
import { CloudflareTextProvider } from "./cloudflare";
import { DemoTextProvider } from "./demo";
import type { TextProvider } from "./types";

export const DEFAULT_TEXT_MODEL = "claude-opus-5-5";

/**
 * Picks the text provider from server env:
 * - "anthropic" (Claude, best quality): TEXT_AI_API_KEY
 * - "cloudflare" (free daily allowance): CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 * With no TEXT_AI_PROVIDER: Claude if its key is set, else Cloudflare if set,
 * else the demo provider, whose output is always labelled "Demo" in the UI.
 */
export function getTextProvider(env: Record<string, string | undefined> = process.env): TextProvider {
  const cf = env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN;
  const provider = (env.TEXT_AI_PROVIDER || (env.TEXT_AI_API_KEY ? "anthropic" : cf ? "cloudflare" : "demo")).toLowerCase();
  switch (provider) {
    case "demo":
      return new DemoTextProvider();
    case "anthropic":
      if (env.TEXT_AI_API_KEY) return new AnthropicTextProvider(env.TEXT_AI_API_KEY, env.TEXT_AI_MODEL || DEFAULT_TEXT_MODEL);
    // No Claude key: fall through to the free Cloudflare model if it's set up.
    case "cloudflare":
      return cf
        ? new CloudflareTextProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID!, apiToken: env.CLOUDFLARE_API_TOKEN!, model: env.CLOUDFLARE_TEXT_MODEL || undefined })
        : new DemoTextProvider();
    default:
      throw new Error(`Unknown TEXT_AI_PROVIDER "${provider}"`);
  }
}
