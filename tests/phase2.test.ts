import { describe, expect, it, vi } from "vitest";
import { DemoImageProvider, wrap } from "@/lib/ai/image/demo";
import { getImageProvider } from "@/lib/ai/image";
import { withRetry } from "@/lib/ai/retry";
import { ProviderError } from "@/lib/ai/text/types";
import { assertWithinBudget, BudgetExceededError } from "@/lib/usage/budget";
import { MemoryLedger, type UsageEntry } from "@/lib/usage/ledger";
import { estimateTextCost, monthlyBudgetUsd } from "@/lib/usage/pricing";

const entry = (cost: number, created_at?: string): UsageEntry => ({
  workspace_id: "w", kind: "text", provider: "p", model: "m", source: "ai", input_tokens: 0, output_tokens: 0, images: 0, est_cost_usd: cost, status: "ok", error: null, created_at,
});

describe("pricing", () => {
  it("estimates text cost per million tokens", () => {
    expect(estimateTextCost("claude-opus-5-5", 1_000_000, 1_000_000)).toBeCloseTo(24);
    expect(estimateTextCost("claude-haiku-5-5", 2000, 1000)).toBeCloseTo(0.0007);
    expect(estimateTextCost(null, 1000, 1000)).toBe(0);
  });
  it("prices unknown models at the safe (high) fallback", () => {
    expect(estimateTextCost("some-new-model", 1_000_000, 0)).toBe(10);
  });
  it("reads the budget from env with a $10 default", () => {
    expect(monthlyBudgetUsd({})).toBe(10);
    expect(monthlyBudgetUsd({ AI_MONTHLY_BUDGET_USD: "2.5" })).toBe(2.5);
    expect(monthlyBudgetUsd({ AI_MONTHLY_BUDGET_USD: "0" })).toBe(0);
    expect(monthlyBudgetUsd({ AI_MONTHLY_BUDGET_USD: "abc" })).toBe(10);
  });
});

describe("budget cap", () => {
  it("blocks paid calls once this month's spend reaches the budget", async () => {
    const ledger = new MemoryLedger();
    await ledger.record(entry(1.5));
    await expect(assertWithinBudget(ledger, true, { AI_MONTHLY_BUDGET_USD: "1" })).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(assertWithinBudget(ledger, true, { AI_MONTHLY_BUDGET_USD: "5" })).resolves.toBeUndefined();
  });
  it("never blocks free demo calls", async () => {
    const ledger = new MemoryLedger();
    await ledger.record(entry(100));
    await expect(assertWithinBudget(ledger, false, { AI_MONTHLY_BUDGET_USD: "0" })).resolves.toBeUndefined();
  });
  it("ignores spend from previous months", async () => {
    const ledger = new MemoryLedger();
    await ledger.record(entry(100, "2000-01-01T00:00:00.000Z"));
    expect(await ledger.monthSpendUsd()).toBe(0);
  });
});

describe("withRetry", () => {
  const noSleep = () => Promise.resolve();
  it("retries retryable errors up to the limit", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ProviderError("x", 502, true)).mockResolvedValueOnce("ok");
    expect(await withRetry(fn, 3, 1, noSleep)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("stops after the attempt limit", async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError("x", 502, true));
    await expect(withRetry(fn, 3, 1, noSleep)).rejects.toThrow("x");
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError("bad", 400, false));
    await expect(withRetry(fn, 3, 1, noSleep)).rejects.toThrow("bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("demo image provider", () => {
  it("returns a labelled, escaped 2:3 SVG placeholder at zero cost", async () => {
    const img = await new DemoImageProvider().generate(`Trench coat <script>alert("x")</script> & scarf`, { width: 1000, height: 1500 });
    const svg = new TextDecoder().decode(img.bytes);
    expect(img.source).toBe("demo");
    expect(img.est_cost_usd).toBe(0);
    expect(img.contentType).toBe("image/svg+xml");
    expect(svg).toContain("DEMO IMAGE");
    expect(svg).toContain('width="1000" height="1500"');
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
  it("wraps long prompts with an ellipsis", () => {
    const lines = wrap("word ".repeat(200), 20, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith("…")).toBe(true);
  });
  it("is chosen when no image provider is configured", () => {
    expect(getImageProvider({}).source).toBe("demo");
    expect(() => getImageProvider({ IMAGE_AI_PROVIDER: "foo", IMAGE_AI_API_KEY: "k" })).toThrow(/not supported/);
  });
});
