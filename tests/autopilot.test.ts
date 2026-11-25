import { describe, expect, it, vi } from "vitest";
import { getImageProvider } from "@/lib/ai/image";
import { CloudflareImageProvider } from "@/lib/ai/image/cloudflare";
import { FalImageProvider } from "@/lib/ai/image/fal";
import { OpenAIImageProvider } from "@/lib/ai/image/openai";
import { buildImagePrompt } from "@/lib/ai/image/prompt";
import { ProviderError } from "@/lib/ai/text/types";
import { runAutopilotStep, spacingMs, type AutopilotDeps, type AutopilotWorkspace, type Idea } from "@/lib/autopilot/engine";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]).toString("base64");
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("image provider selection", () => {
  it("uses fal when its key is set, and the chosen model's price", () => {
    const p = getImageProvider({ FAL_KEY: "k", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" });
    expect(p).toBeInstanceOf(FalImageProvider);
    expect(getImageProvider({ IMAGE_AI_PROVIDER: "cloudflare", FAL_KEY: "k", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" })).toBeInstanceOf(CloudflareImageProvider);
  });
  it("prefers free Cloudflare, then OpenAI, then demo", () => {
    expect(getImageProvider({}).source).toBe("demo");
    expect(getImageProvider({ OPENAI_API_KEY: "k" })).toBeInstanceOf(OpenAIImageProvider);
    expect(getImageProvider({ IMAGE_AI_API_KEY: "k", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" })).toBeInstanceOf(CloudflareImageProvider);
    expect(getImageProvider({ IMAGE_AI_PROVIDER: "openai", IMAGE_AI_API_KEY: "k", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" })).toBeInstanceOf(OpenAIImageProvider);
    expect(getImageProvider({ IMAGE_AI_PROVIDER: "cloudflare" }).source).toBe("demo");
  });
});

describe("OpenAI image adapter", () => {
  it("asks for a portrait JPEG and returns the bytes with a cost estimate", async () => {
    const fetchImpl = vi.fn(async () => json(200, { data: [{ b64_json: JPEG }] }));
    const p = new OpenAIImageProvider({ apiKey: "sk-test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const img = await p.generate("trench coat flat lay");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ size: "1024x1536", output_format: "jpeg", quality: "medium", model: "gpt-image-1.5" });
    expect(sent.prompt).toContain("trench coat flat lay");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(img).toMatchObject({ contentType: "image/jpeg", extension: "jpg", source: "ai" });
    expect(img.est_cost_usd).toBeGreaterThan(0);
  });
  it("maps rate limits to retryable and bad keys to non-retryable errors", async () => {
    const rl = new OpenAIImageProvider({ apiKey: "k", fetchImpl: (async () => json(429, { error: { message: "slow down" } })) as unknown as typeof fetch });
    await expect(rl.generate("x")).rejects.toMatchObject({ retryable: true });
    const bad = new OpenAIImageProvider({ apiKey: "k", fetchImpl: (async () => json(401, { error: { message: "bad key" } })) as unknown as typeof fetch });
    await expect(bad.generate("x")).rejects.toMatchObject({ retryable: false });
  });
  it("never asks for logos or watermarks", () => {
    const p = buildImagePrompt({ title: "7 Linen Outfits for Summer", scene: "Vertical 2:3 grid of linen outfits, bold number badges", kind: "fashion", overlay: "elegant" });
    expect(p).toContain('titled "7 Linen Outfits for Summer"');
    expect(p).toMatch(/Avoid: any text, letters, words, numbers/);
    expect(p).toMatch(/upper third/);
    expect(p).not.toMatch(/number badges/);
    expect(p).toMatch(/fashion editorial/i);
  });
});

describe("fal image adapter", () => {
  it("asks FLUX.3 Klein for a 1024x1536 JPEG and reads the inline image", async () => {
    const fetchImpl = vi.fn(async () => json(200, { images: [{ url: `data:image/jpeg;base64,${JPEG}`, content_type: "image/jpeg" }], has_nsfw_concepts: [false] }));
    const p = new FalImageProvider({ apiKey: "fk", fetchImpl: fetchImpl as unknown as typeof fetch });
    const img = await p.generate("linen dress");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://fal.run/blackforestlabs/flux-3/klein/text-to-image");
    expect((init.headers as Record<string, string>).Authorization).toBe("Key fk");
    expect(JSON.parse(init.body as string)).toMatchObject({ image_size: { width: 1024, height: 1536 }, output_format: "jpeg" });
    expect(img).toMatchObject({ contentType: "image/jpeg", est_cost_usd: 0.011 });
    expect(Array.from(img.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
  });
  it("uses an aspect ratio for Nano Banana and downloads hosted images", async () => {
    const fetchImpl = vi.fn(async (u: string) =>
      u.startsWith("https://fal.run") ? json(200, { images: [{ url: "https://v3.fal.media/x.jpg" }] }) : new Response(Buffer.from(JPEG, "base64"), { headers: { "content-type": "image/jpeg" } }),
    );
    const p = new FalImageProvider({ apiKey: "fk", model: "fal-ai/nano-banana-2", fetchImpl: fetchImpl as unknown as typeof fetch });
    const img = await p.generate("x");
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).aspect_ratio).toBe("2:3");
    expect(img.est_cost_usd).toBe(0.067);
  });
  it("explains an empty balance", async () => {
    const p = new FalImageProvider({ apiKey: "k", fetchImpl: (async () => json(402, { detail: "Insufficient balance" })) as unknown as typeof fetch });
    await expect(p.generate("x")).rejects.toThrow(/no credit/);
  });
});

describe("Cloudflare image adapter", () => {
  it("sends multipart prompt + 2:3 size and detects the image type", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true, result: { image: PNG } }));
    const p = new CloudflareImageProvider({ accountId: "acc", apiToken: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    const img = await p.generate("macro chart");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/black-forest-labs/flux-2-klein-4b");
    const form = init.body as FormData;
    expect(form.get("width")).toBe("768");
    expect(form.get("height")).toBe("1152");
    expect(String(form.get("prompt"))).toContain("macro chart");
    expect(img).toMatchObject({ contentType: "image/png", extension: "png", est_cost_usd: 0 });
  });
  it("explains the daily free limit", async () => {
    const p = new CloudflareImageProvider({ accountId: "a", apiToken: "t", fetchImpl: (async () => json(429, { success: false, errors: [{ message: "neurons exhausted" }] })) as unknown as typeof fetch });
    await expect(p.generate("x")).rejects.toThrow(/daily free image limit/);
  });
});

// ---------------------------------------------------------------------------

const ws: AutopilotWorkspace = { workspace_id: "w1", owner_id: "u1", kind: "fashion", board_id: "b1", board_name: "Board", pins_per_day: 3, link: null, timezone: "UTC", best_time: false, remix_winners: false, auto_trends: false, trend_interest: null };
const NOW = new Date("2026-11-25T12:00:00Z");

function fakeDeps(opts: Partial<Omit<AutopilotDeps, "ideas">> & { ideas?: Idea[]; ready?: string[] } = {}) {
  const { ideas: queued, ready: readyIds, ...over } = opts;
  const ready = [...(readyIds ?? [])];
  const queue = [...(queued ?? [])];
  const state: { paused_reason: string | null }[] = [];
  const finished: { idea: Idea; status: string }[] = [];
  const published: string[] = [];
  const deps: AutopilotDeps = {
    now: () => NOW,
    readinessProblems: async () => [],
    postingHours: async () => null,
    recentPublishes: async () => ({ count: 0, lastAt: null }),
    nextReadyDraft: async () => (ready.length ? { id: ready[0] } : null),
    ideas: {
      next: async () => queue.shift() ?? null,
      finish: async (idea, r) => void finished.push({ idea, status: r.status }),
    },
    createPins: async () => {
      ready.push("new1", "new2");
      return 2;
    },
    publish: async (_w, id) => {
      published.push(id);
      ready.splice(ready.indexOf(id), 1);
      return { ok: true, pinId: `pin-${id}` };
    },
    setState: async (_w, s) => void state.push(s),
    isBudgetError: (e) => (e as Error).message.startsWith("Monthly AI budget"),
    ...over,
  };
  return { deps, state, finished, published };
}

describe("autopilot engine", () => {
  it("does nothing but report why when setup is incomplete", async () => {
    const f = fakeDeps({ readinessProblems: async () => ["Connect Pinterest."], ready: ["d1"] });
    const out = await runAutopilotStep(ws, f.deps);
    expect(out.action).toBe("blocked");
    expect(f.published).toEqual([]);
    expect(f.state.at(-1)?.paused_reason).toBe("Connect Pinterest.");
  });

  it("publishes the oldest ready pin, one per step", async () => {
    const f = fakeDeps({ ready: ["d1", "d2"] });
    const out = await runAutopilotStep(ws, f.deps);
    expect(out).toMatchObject({ action: "published", draftId: "d1", pinId: "pin-d1" });
    expect(f.published).toEqual(["d1"]);
  });

  it("respects the daily limit", async () => {
    const f = fakeDeps({ ready: ["d1"], recentPublishes: async () => ({ count: 3, lastAt: new Date(NOW.getTime() - 10 * 3600_000) }) });
    expect((await runAutopilotStep(ws, f.deps)).action).toBe("daily_limit");
    expect(f.published).toEqual([]);
  });

  it("spreads pins across the day", async () => {
    expect(spacingMs(3)).toBe(Math.floor(8 * 3600_000 * 0.9));
    const f = fakeDeps({ ready: ["d1"], recentPublishes: async () => ({ count: 1, lastAt: new Date(NOW.getTime() - 3600_000) }) });
    const out = await runAutopilotStep(ws, f.deps);
    expect(out.action).toBe("waiting");
    expect(f.published).toEqual([]);
    const g = fakeDeps({ ready: ["d1"], recentPublishes: async () => ({ count: 1, lastAt: new Date(NOW.getTime() - 8 * 3600_000) }) });
    expect((await runAutopilotStep(ws, g.deps)).action).toBe("published");
  });

  it("turns the next idea into pins when none are ready, then publishes one", async () => {
    const f = fakeDeps({ ideas: [{ id: "i1", idea: "Autumn trench coat outfits" }] });
    const out = await runAutopilotStep(ws, f.deps);
    expect(out.action).toBe("published");
    expect(f.finished).toEqual([{ idea: { id: "i1", idea: "Autumn trench coat outfits" }, status: "done" }]);
    expect(f.published).toEqual(["new1"]);
  });

  it("goes idle and says so when the queue is empty", async () => {
    const f = fakeDeps();
    expect((await runAutopilotStep(ws, f.deps)).action).toBe("idle");
    expect(f.state.at(-1)?.paused_reason).toMatch(/queue is empty/);
  });

  it("puts the idea back and pauses when the AI budget is used up", async () => {
    const f = fakeDeps({
      ideas: [{ id: "i1", idea: "x idea" }],
      createPins: async () => {
        throw new Error("Monthly AI budget reached ($10.00 of $10.00).");
      },
    });
    const out = await runAutopilotStep(ws, f.deps);
    expect(out.action).toBe("blocked");
    expect(f.finished[0].status).toBe("queued");
    expect(f.published).toEqual([]);
  });

  it("marks an idea failed when generation errors", async () => {
    const f = fakeDeps({
      ideas: [{ id: "i1", idea: "x idea" }],
      createPins: async () => {
        throw new ProviderError("model overloaded", 503, true);
      },
    });
    expect((await runAutopilotStep(ws, f.deps)).action).toBe("failed");
    expect(f.finished[0].status).toBe("failed");
  });

  it("reports a failed publish without retrying in the same step", async () => {
    const publish = vi.fn(async () => ({ ok: false, error: "Board not found" }));
    const f = fakeDeps({ ready: ["d1"], publish });
    const out = await runAutopilotStep(ws, f.deps);
    expect(out).toMatchObject({ action: "failed", detail: "Board not found" });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
