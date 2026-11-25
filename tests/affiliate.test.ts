import { describe, expect, it } from "vitest";
import { addDisclosure, amazonStore, applyAmazonTag, looksAffiliate, replaceInLink } from "@/lib/tools/affiliate";
import { LIMITS } from "@/lib/drafts/validation";

describe("affiliate tools", () => {
  it("sets the right tag per Amazon country and keeps other parameters", () => {
    const tags = { "amazon.com": "us-20", "amazon.co.uk": "uk-21" };
    expect(applyAmazonTag("https://www.amazon.com/dp/B0X?th=1", tags)).toBe("https://www.amazon.com/dp/B0X?th=1&tag=us-20");
    expect(applyAmazonTag("https://amazon.co.uk/dp/B0X?tag=old-21", tags)).toBe("https://amazon.co.uk/dp/B0X?tag=uk-21");
    expect(applyAmazonTag("https://amazon.de/dp/B0X", tags)).toBe("https://amazon.de/dp/B0X");
    expect(applyAmazonTag("https://myblog.com/p", tags)).toBe("https://myblog.com/p");
    expect(applyAmazonTag("https://amazon.com/dp/B0X", { "amazon.com": "bad tag!" })).toBe("https://amazon.com/dp/B0X");
    expect(amazonStore("https://amazon.com.evil.example/x")).toBeNull();
  });
  it("adds the disclosure once and within Pinterest's limit", () => {
    const d = "#ad · This pin contains affiliate links.";
    const once = addDisclosure("Great shoes.", d);
    expect(once).toBe(`Great shoes.\n${d}`);
    expect(addDisclosure(once, d)).toBe(once);
    expect(addDisclosure("Already #ad here", d)).toBe("Already #ad here");
    expect(addDisclosure("x".repeat(LIMITS.description), d).length).toBeLessThanOrEqual(LIMITS.description);
  });
  it("find & replace keeps only valid links", () => {
    expect(replaceInLink("https://old.example/p?x=1", "old.example", "new.example")).toBe("https://new.example/p?x=1");
    expect(replaceInLink("https://old.example/p", "https://", "javascript:")).toBeNull();
  });
  it("spots affiliate links", () => {
    expect(looksAffiliate("https://amzn.to/abc")).toBe(true);
    expect(looksAffiliate("https://shop.example/p?ref=me")).toBe(true);
    expect(looksAffiliate("https://myblog.com/post")).toBe(false);
  });
});
