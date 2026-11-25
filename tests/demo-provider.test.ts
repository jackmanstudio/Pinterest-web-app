import { describe, expect, it } from "vitest";
import { DemoTextProvider } from "@/lib/ai/text/demo";
import { findNearDuplicates } from "@/lib/drafts/distinctness";
import { DraftSetSchema } from "@/lib/drafts/validation";
import { EMPTY_BRAND } from "@/lib/types";

const req = (idea: string) => ({ workspace: "fashion" as const, idea, brand: { ...EMPTY_BRAND, brand_name: "Acme", focus_keywords: ["style"] } });

describe("DemoTextProvider", () => {
  it("returns five schema-valid drafts labelled as demo", async () => {
    const res = await new DemoTextProvider().generateDrafts(req("layering a trench coat for autumn"));
    expect(res.source).toBe("demo");
    expect(res.model).toBeNull();
    expect(() => DraftSetSchema.parse({ drafts: res.drafts })).not.toThrow();
  });

  it("produces five meaningfully different drafts", async () => {
    for (const idea of ["trench coat", "minimalist capsule wardrobe for travel", "x".repeat(400)]) {
      const res = await new DemoTextProvider().generateDrafts(req(idea));
      expect(new Set(res.drafts.map((d) => d.angle)).size).toBe(5);
      expect(new Set(res.drafts.map((d) => d.title)).size).toBe(5);
      expect(findNearDuplicates(res.drafts)).toEqual([]);
    }
  });
});
