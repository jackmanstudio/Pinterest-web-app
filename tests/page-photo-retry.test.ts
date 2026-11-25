import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { pagePhoto } from "@/lib/tools/pagePhoto";

describe("page photo download", () => {
  it("retries a refused download and sends browser-like headers with the page as referer", async () => {
    const jpg = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#aa8866" } }).jpeg().toBuffer();
    const seen: Headers[] = [];
    let calls = 0;
    const f = (async (_u: URL, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      calls++;
      return calls < 3 ? new Response("no", { status: 404 }) : new Response(jpg, { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const img = await pagePhoto("http://93.184.216.34/p.jpg", { fetchImpl: f, referer: "https://shop.example/sweaters", waitMs: 1 });
    expect(calls).toBe(3);
    expect(img.source).toBe("manual");
    expect(seen[0].get("referer")).toBe("https://shop.example/sweaters");
    expect(seen[0].get("user-agent")).toMatch(/Chrome/);
  });
  it("gives up after three tries with a clear message", async () => {
    const f = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(pagePhoto("http://93.184.216.34/p.jpg", { fetchImpl: f, waitMs: 1 })).rejects.toThrow(/couldn't be downloaded \(404\)/);
  });
});
