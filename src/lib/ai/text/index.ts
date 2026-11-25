import "server-only";
import { AnthropicTextProvider } from "./anthropic";
import { DemoTextProvider } from "./demo";
import type { TextProvider } from "./types";

export const DEFAULT_TEXT_MODEL = "claude-opus-5-5";

/**
 * Picks the text provider from server env. Without a key the app falls back to
 * the demo provider, whose output is always labelled "Demo" in the UI.
 */
export function getTextProvider(env: Record<string, string | undefined> = process.env): TextProvider {
  const provider = (env.TEXT_AI_PROVIDER || "anthropic").toLowerCase();
  const key = env.TEXT_AI_API_KEY;
  if (!key) return new DemoTextProvider();
  switch (provider) {
    case "anthropic":
      return new AnthropicTextProvider(key, env.TEXT_AI_MODEL || DEFAULT_TEXT_MODEL);
    default:
      throw new Error(`Unknown TEXT_AI_PROVIDER "${provider}"`);
  }
}
