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
import { PIN_ANGLES } from "@/lib/drafts/angles";

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
    // One call per pin, all in parallel; usage is summed.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(r).toMatchObject({ source: "ai", usage: { input_tokens: 4500, output_tokens: 6000 } });
    expect(r.drafts).toHaveLength(5);
    expect(r.drafts.map((d) => d.angle)).toEqual(PIN_ANGLES.map((a) => a.label));
  });
  it("writes only the pins asked for, one parallel call each, each told its own angle", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, result: { response: { drafts: [draft(1)] } } }), { status: 200 }));
    const p = new CloudflareTextProvider({ accountId: "acc", apiToken: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.generateDrafts({ workspace: "fashion", idea: "linen outfits", count: 3, brand: { brand_name: "", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.drafts).toHaveLength(3);
    const prompts = fetchImpl.mock.calls.map((c) => JSON.parse(((c as unknown as [string, RequestInit])[1].body) as string).messages[1].content as string);
    expect(prompts[0]).toMatch(/Write ONE draft for this angle/);
    expect(new Set(prompts).size).toBe(3);
    const system = JSON.parse(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body) as string).messages[0].content as string;
    expect(system).toMatch(/exactly one pin draft/);
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

describe("brand analysis and timeouts", () => {
  it("parses a brand analysis", async () => {
    const brand = { voice: "Warm, practical.", audience: "Busy parents.", focus_keywords: ["easy dinners"], image_style: "Bright kitchen light.", cta: "Save for later" };
    const p = new CloudflareTextProvider({ accountId: "a", apiToken: "t", fetchImpl: (async () => new Response(JSON.stringify({ success: true, result: { response: brand } }))) as unknown as typeof fetch });
    const out = await p.analyzeBrand("Title: Easy Dinners");
    expect(out.brand.focus_keywords).toEqual(["easy dinners"]);
  });
  it("reports a timeout as a retryable error instead of hanging", async () => {
    const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const p = new CloudflareTextProvider({ accountId: "a", apiToken: "t", fetchImpl: (async () => { throw err; }) as unknown as typeof fetch });
    await expect(p.analyzeBrand("x")).rejects.toMatchObject({ retryable: true, status: 504 });
  });
});
