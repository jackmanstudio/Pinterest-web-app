import "server-only";
import { CloudflareImageProvider } from "./cloudflare";
import { DemoImageProvider } from "./demo";
import { FalImageProvider } from "./fal";
import { OpenAIImageProvider, type ImageQuality } from "./openai";
import type { ImageProvider } from "./types";

type Env = Record<string, string | undefined>;

function costOverride(env: Env): number | undefined {
  const v = env.IMAGE_AI_COST_PER_IMAGE_USD;
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * One entry per image API. To switch to a new (paid) API later:
 *   1. add a file next to this one that implements ImageProvider (see fal.ts),
 *   2. add an entry here with the env vars it needs,
 *   3. set IMAGE_AI_PROVIDER=<its name> (and its key) in Vercel and redeploy.
 * Nothing else in the app changes: every image (Studio, Autopilot, one-step
 * pins) goes through getImageProvider(), and usage/cost is logged per provider.
 */
interface ProviderEntry {
  /** True when the env has what this provider needs. */
  ready(env: Env): boolean;
  create(env: Env): ImageProvider;
}

const PROVIDERS: Record<string, ProviderEntry> = {
  // Recommended paid: good quality, ~$0.011/image.
  fal: {
    ready: (env) => Boolean(env.FAL_KEY),
    create: (env) => new FalImageProvider({ apiKey: env.FAL_KEY!, model: env.IMAGE_AI_MODEL || undefined, costPerImage: costOverride(env) }),
  },
  // Free tier, ~60 images/day.
  cloudflare: {
    ready: (env) => Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
    create: (env) =>
      new CloudflareImageProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID!, apiToken: env.CLOUDFLARE_API_TOKEN!, model: env.IMAGE_AI_MODEL || undefined, costPerImage: costOverride(env) }),
  },
  // Paid alternative.
  openai: {
    ready: (env) => Boolean(env.IMAGE_AI_API_KEY || env.OPENAI_API_KEY),
    create: (env) => {
      const q = (env.IMAGE_AI_QUALITY || "medium").toLowerCase();
      return new OpenAIImageProvider({
        apiKey: (env.IMAGE_AI_API_KEY || env.OPENAI_API_KEY)!,
        model: env.IMAGE_AI_MODEL || undefined,
        quality: (["low", "medium", "high"].includes(q) ? q : "medium") as ImageQuality,
        costPerImage: costOverride(env),
      });
    },
  },
  demo: { ready: () => true, create: () => new DemoImageProvider() },
};

/** Image APIs this build can use (for IMAGE_AI_PROVIDER). */
export const IMAGE_PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * Picks the image provider from server env. IMAGE_AI_PROVIDER chooses one by
 * name. Without it, the first with credentials wins in the order above (a paid
 * key you added is assumed to be the one you want). A chosen provider without
 * its credentials, or no credentials at all, gives the labelled demo placeholder.
 */
export function getImageProvider(env: Env = process.env): ImageProvider {
  const chosen = (env.IMAGE_AI_PROVIDER || "").trim().toLowerCase();
  if (chosen) {
    const entry = PROVIDERS[chosen];
    if (!entry) throw new Error(`IMAGE_AI_PROVIDER "${chosen}" is not supported. Use ${IMAGE_PROVIDER_NAMES.map((n) => `"${n}"`).join(", ")}.`);
    return entry.ready(env) ? entry.create(env) : new DemoImageProvider();
  }
  const name = IMAGE_PROVIDER_NAMES.find((n) => PROVIDERS[n].ready(env))!;
  return PROVIDERS[name].create(env);
}
