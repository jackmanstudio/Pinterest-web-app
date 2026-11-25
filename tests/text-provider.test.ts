import { describe, expect, it, vi } from "vitest";
import { getTextProvider } from "@/lib/ai/text";

describe("getTextProvider", () => {
  it("falls back to the labelled demo provider without a key", () => {
    expect(getTextProvider({}).source).toBe("demo");
  });
  it("uses Claude when a key is set", () => {
    expect(getTextProvider({ TEXT_AI_API_KEY: "test" }).source).toBe("ai");
  });
  it("rejects unknown providers", () => {
    expect(() => getTextProvider({ TEXT_AI_API_KEY: "k", TEXT_AI_PROVIDER: "nope" })).toThrow();
  });
});

import { CloudflareTextProvider, normalizeDrafts } from "@/lib/ai/text/cloudflare";

describe("Cloudflare text provider", () => {
  const draft = (i: number) => ({
    angle: "x", concept: `Concept ${i}`, title: `Title number ${i} `.repeat(i === 0 ? 20 : 1), description: `Description ${i}`,
    tags: ["#linen", "summer"], alt_text: `Alt ${i}`, image_prompt: `Scene ${i}`,
  });
  it("is chosen when only Cloudflare credentials are set; Claude wins if both", () => {
    expect(getTextProvider({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" })).toBeInstanceOf(CloudflareTextProvider);
    expect(getTextProvider({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t", TEXT_AI_API_KEY: "k" }).name).toMatch(/Claude/);
  });
  it("trims over-long fields and fixes angles and tags", () => {
    const n = normalizeDrafts({ drafts: [0, 1, 2, 3, 4].map(draft) }) as { drafts: { title: string; angle: string; tags: string[] }[] };
    expect(n.drafts[0].title.length).toBeLessThanOrEqual(100);
    expect(n.drafts[0].angle).toBe("How-to / tutorial");
    expect(n.drafts[0].tags).toEqual(["linen", "summer"]);
  });
  it("sends JSON mode and parses a string reply", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, result: { response: JSON.stringify({ drafts: [0, 1, 2, 3, 4].map(draft) }), usage: { prompt_tokens: 900, completion_tokens: 1200 } } }), { status: 200 }),
    );
    const p = new CloudflareTextProvider({ accountId: "acc", apiToken: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.generateDrafts({ workspace: "fashion", idea: "linen outfits", brand: { brand_name: "", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    const sent = JSON.parse(init.body as string);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.messages[1].content).toContain("linen outfits");
    expect(r).toMatchObject({ source: "ai", usage: { input_tokens: 900, output_tokens: 1200 } });
    expect(r.drafts).toHaveLength(5);
  });
  it("asks for a retry when the reply is unusable", async () => {
    const p = new CloudflareTextProvider({ accountId: "a", apiToken: "t", fetchImpl: (async () => new Response(JSON.stringify({ success: true, result: { response: "not json" } }))) as unknown as typeof fetch });
    await expect(p.generateDrafts({ workspace: "macro", idea: "x idea", brand: { brand_name: "", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] } })).rejects.toMatchObject({ retryable: true });
  });
});

describe("text provider fallback", () => {
  it("uses Cloudflare when TEXT_AI_PROVIDER=anthropic but no Claude key is set", () => {
    expect(getTextProvider({ TEXT_AI_PROVIDER: "anthropic", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" })).toBeInstanceOf(CloudflareTextProvider);
    expect(getTextProvider({ TEXT_AI_PROVIDER: "anthropic" }).source).toBe("demo");
  });
});
