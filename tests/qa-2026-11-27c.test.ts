// QA round 3 (2026-11-27) regression tests. Mocked: the AI provider and the request context.
import { describe, expect, it, vi } from "vitest";
import { duplicateNotice, photoTopic } from "@/lib/photos/validate";
import { validateRunAt } from "@/lib/workflow/checks";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

const ledger = { mode: "memory", monthSpendUsd: async () => 0, record: vi.fn(async () => {}), recent: async () => [] };
let failContext: Error | null = null;
vi.mock("@/lib/server/context", () => ({
  getRequestContext: async () => {
    if (failContext) throw failContext;
    return { mode: "demo", ledger };
  },
  workspaceIdFor: async () => "demo-fashion",
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
const ideas: string[] = [];
vi.mock("@/lib/ai/text", () => ({
  getTextProvider: () => ({
    name: "Text only AI",
    source: "ai",
    // No describePhotos: this AI can't see photos (like the free Cloudflare model).
    generateDrafts: async ({ idea }: { idea: string }) => {
      ideas.push(idea);
      return {
        source: "ai", provider: "Text only AI", model: "t",
        drafts: Array.from({ length: 5 }, (_, i) => ({ angle: "a", concept: "c", title: `${idea} pin ${i}`, description: `About ${idea}.`, tags: [idea], alt_text: idea, image_prompt: "p" })),
      };
    },
  }),
}));

const brand = { brand_name: "", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] };
const jpeg = Buffer.from("fake-jpeg").toString("base64");
const req = (body: unknown) => new Request("http://localhost/api/photo-pins", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.8.8.8" }, body: JSON.stringify(body) });

describe("QA3-02: photo pins without a vision AI use each photo's own topic", () => {
  it("writes each photo's text from its own topic, not the first photo's", async () => {
    ideas.length = 0;
    const { POST } = await import("@/app/api/photo-pins/route");
    const res = await POST(req({ workspace: "fashion", brand, photos: [{ topic: "red wool coat", jpeg }, { topic: "linen summer dress", jpeg }, { topic: "red wool coat", jpeg }] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.basedOn).toBe("topic");
    expect(body.pins.map((p: { title: string }) => p.title)).toEqual(["red wool coat pin 0", "linen summer dress pin 0", "red wool coat pin 1"]);
    // One AI call per distinct topic.
    expect([...ideas].sort()).toEqual(["linen summer dress", "red wool coat"]);
  });
  it("uses the shared topic for every photo when one is typed", async () => {
    ideas.length = 0;
    const { POST } = await import("@/app/api/photo-pins/route");
    const body = await (await POST(req({ workspace: "fashion", brand, topic: "winter outfits", photos: [{ topic: "dsc 0042", jpeg }, { topic: "", jpeg }] }))).json();
    expect(ideas).toEqual(["winter outfits"]);
    expect(body.pins[0].title).not.toEqual(body.pins[1].title);
  });
  it("asks for a topic when a photo has none and no shared topic is typed", async () => {
    const { POST } = await import("@/app/api/photo-pins/route");
    const res = await POST(req({ workspace: "fashion", brand, photos: [{ topic: "red coat", jpeg }, { topic: "", jpeg }] }));
    expect(res.status).toBe(422);
  });
  it("picks the topic by the documented rule", () => {
    expect(photoTopic("red coat", "")).toBe("red coat");
    expect(photoTopic("red coat", "winter outfits")).toBe("winter outfits");
    expect(photoTopic("ab", "")).toBeNull();
    expect(photoTopic("  ", "  ")).toBeNull();
  });
});

describe("QA3-01: the same photo is not added twice", () => {
  it("explains which photos were left out", () => {
    expect(duplicateNotice([])).toBeNull();
    expect(duplicateNotice(["a.jpg"])).toMatch(/This photo is already in the list.*a\.jpg/);
    expect(duplicateNotice(["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"])).toMatch(/These photos.*a\.jpg, b\.jpg, c\.jpg and 2 more/);
  });
});

describe("QA3-03: schedule time is checked before sending", () => {
  it("rejects empty, past and too-far times", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    expect(validateRunAt("", now)).toMatch(/valid date/);
    expect(validateRunAt("2026-11-27T11:00:00Z", now)).toMatch(/5 minutes/);
    expect(validateRunAt("2027-12-01T00:00:00Z", now)).toMatch(/180 days/);
    expect(validateRunAt("2026-11-27T13:00:00Z", now)).toBeNull();
  });
});

describe("QA3-04: unexpected server errors are logged and not shown raw", () => {
  it("usage hides the internal message and returns an error ID", async () => {
    failContext = new Error('relation "secret_internal_table" does not exist');
    try {
      const { GET } = await import("@/app/api/usage/route");
      const res = await GET(new Request("http://localhost/api/usage"));
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.error).not.toMatch(/secret_internal_table/);
      expect(body.errorId).toBeTruthy();
      expect(res.headers.get("x-error-id")).toBe(body.errorId);
    } finally {
      failContext = null;
    }
  });
});
