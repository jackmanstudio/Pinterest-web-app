import { describe, expect, it } from "vitest";
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
