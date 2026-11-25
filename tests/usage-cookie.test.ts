import { describe, expect, it } from "vitest";
import { decodeUsage, encodeUsage } from "@/lib/usage/cookieLedger";

describe("browser usage ledger", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const s = { m: "2026-11", spent: 0.0123, e: [[1764072000, 1, "Cloudflare", "flux", 1, 0, 0, 1, 0.0011, 1, "fashion"]] as never };
  it("round-trips and rejects tampering", () => {
    const raw = encodeUsage(s, "k");
    expect(decodeUsage(raw, "k", now).spent).toBeCloseTo(0.0123);
    const [body] = raw.split(".");
    const forged = Buffer.from(JSON.stringify({ ...s, spent: 0 })).toString("base64url");
    expect(decodeUsage(`${forged}.${raw.split(".")[1]}`, "k", now).spent).toBe(0);
    expect(decodeUsage(`${forged}.${raw.split(".")[1]}`, "k", now).e).toEqual([]);
    expect(body.length).toBeGreaterThan(0);
  });
  it("starts a new month at zero", () => {
    expect(decodeUsage(encodeUsage(s, "k"), "k", new Date("2026-12-02T00:00:00Z")).spent).toBe(0);
  });
  it("stays well under the 4 KB cookie limit with 20 entries", () => {
    const e = Array.from({ length: 20 }, () => [1764072000, 0, "Cloudflare llama-3.3-70b-", "llama-3.3-70b-instruct-fp8-fast", 1, 2500, 1800, 0, 0.004321, 1, "fashion"]);
    expect(encodeUsage({ m: "2026-11", spent: 1, e: e as never }, "k").length).toBeLessThan(3800);
  });
});

describe("per-call cookies", async () => {
  const { encodeEntry, decodeEntry } = await import("@/lib/usage/cookieLedger");
  it("signs each call and stays small", () => {
    const c = [1764072000, 0, "Cloudflare llama-3.3-70b-", "llama-3.3-70b-instruct-fp8-fast", 1, 2500, 1800, 0, 0.004321, 1, "fashion"] as never;
    const raw = encodeEntry(c, "k");
    expect(decodeEntry(raw, "k")).toEqual(c);
    expect(decodeEntry(raw, "other")).toBeNull();
    expect(raw.length).toBeLessThan(250);
  });
});
