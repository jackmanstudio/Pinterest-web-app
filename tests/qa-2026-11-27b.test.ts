import { describe, expect, it } from "vitest";
import { assertPublicHost, checkUrl, HostNotFound } from "@/lib/tools/urlCheck";

describe("unknown domains", () => {
  it("say the site wasn't found, not 'private network'", async () => {
    await expect(assertPublicHost("this-domain-does-not-exist-qa-1234567.invalid")).rejects.toBeInstanceOf(HostNotFound);
    const r = await checkUrl("https://this-domain-does-not-exist-qa-1234567.invalid/x");
    expect(r.reachable).toBe(false);
    expect(r.messages.join(" ")).toMatch(/wasn't found/);
  });
  it("still blocks private hosts", async () => {
    await expect(assertPublicHost("localhost")).rejects.toThrow("private host");
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow("private host");
  });
});
