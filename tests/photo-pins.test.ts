import { describe, expect, it, vi } from "vitest";
import { fileProblem, fitSize, sizeCheck, topicFromFileName, PHOTO_LIMITS } from "@/lib/photos/validate";
import { photoUserPrompt } from "@/lib/ai/text/prompt";

const ledger = { mode: "memory", monthSpendUsd: async () => 0, record: vi.fn(async () => {}), recent: async () => [] };
vi.mock("@/lib/server/context", () => ({
  getRequestContext: async () => ({ mode: "demo", ledger }),
  workspaceIdFor: async () => "demo-fashion",
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
let vision = true;
const seen: { images: number; topics: string[] }[] = [];
vi.mock("@/lib/ai/text", () => ({
  getTextProvider: () => ({
    name: "Test AI",
    source: "ai",
    generateDrafts: async () => ({
      source: "ai", provider: "Test AI", model: "t",
      drafts: Array.from({ length: 5 }, (_, i) => ({ angle: "a", concept: "c", title: `Topic pin ${i}`, description: "d", tags: ["t"], alt_text: "made up", image_prompt: "p" })),
    }),
    get describePhotos() {
      return vision
        ? async (input: { photos: { topic: string }[] }, images: unknown[]) => {
            seen.push({ images: images.length, topics: input.photos.map((p) => p.topic) });
            return { model: "t", usage: { input_tokens: 1, output_tokens: 1 }, pins: images.map((_, i) => ({ title: `Photo pin ${i}`, description: "Real description.", tags: ["coat"], alt_text: `A coat ${i}` })) };
          }
        : undefined;
    },
  }),
}));

const brand = { brand_name: "", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] };
const jpeg = Buffer.from("fake-jpeg").toString("base64");
const req = (body: unknown) => new Request("http://localhost/api/photo-pins", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.7" }, body: JSON.stringify(body) });

describe("photo checks", () => {
  it("accepts JPG/PNG/WebP up to 20 MB and rejects others", () => {
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "a.webp", type: "image/webp", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "a.gif", type: "image/gif", size: 1000 })).toMatch(/only JPG/);
    expect(fileProblem({ name: "a.png", type: "image/png", size: PHOTO_LIMITS.maxBytes + 1 })).toMatch(/20 MB/);
    expect(fileProblem({ name: "a.png", type: "image/png", size: 0 })).toMatch(/empty/);
  });
  it("flags tiny or unreadable photos and tips on shape", () => {
    expect(sizeCheck(0, 0).problem).toMatch(/damaged/);
    expect(sizeCheck(200, 900).problem).toMatch(/Too small/);
    expect(sizeCheck(1000, 1500)).toEqual({ problem: null, tip: null });
    expect(sizeCheck(1500, 1000).tip).toMatch(/2:3/);
  });
  it("shrinks but never enlarges", () => {
    expect(fitSize(4000, 6000, 2000)).toEqual({ width: 1333, height: 2000 });
    expect(fitSize(800, 1200, 2000)).toEqual({ width: 800, height: 1200 });
  });
  it("turns file names into topics, ignoring camera names", () => {
    expect(topicFromFileName("winter-coat_outfit.jpg")).toBe("winter coat outfit");
    expect(topicFromFileName("IMG_1234.JPG")).toBe("");
  });
  it("numbers photos in the prompt with the user's notes", () => {
    const p = photoUserPrompt({ photos: [{ topic: "red coat" }, { topic: "" }], topic: "winter outfits", brand });
    expect(p).toContain("Photo 1 (user note: red coat)");
    expect(p).toContain("Photo 2\n");
    expect(p).toContain("Return 2 pins");
  });
});

describe("POST /api/photo-pins", () => {
  it("writes one pin per photo from the photos themselves", async () => {
    vision = true;
    const { POST } = await import("@/app/api/photo-pins/route");
    const res = await POST(req({ workspace: "fashion", brand, topic: "winter", photos: [{ topic: "red coat", jpeg }, { jpeg }] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.basedOn).toBe("photo");
    expect(body.pins.map((p: { title: string }) => p.title)).toEqual(["Photo pin 0", "Photo pin 1"]);
    expect(seen.at(-1)).toEqual({ images: 2, topics: ["red coat", ""] });
  });

  it("refuses more than 5 photos per request and bad image data", async () => {
    const { POST } = await import("@/app/api/photo-pins/route");
    expect((await POST(req({ workspace: "fashion", brand, photos: Array.from({ length: 6 }, () => ({ jpeg })) }))).status).toBe(400);
    expect((await POST(req({ workspace: "fashion", brand, photos: [{ jpeg: "<script>" }] }))).status).toBe(400);
  });

  it("falls back to the topic when the AI can't see photos, and asks for a topic if there is none", async () => {
    vision = false;
    const { POST } = await import("@/app/api/photo-pins/route");
    const ok = await (await POST(req({ workspace: "fashion", brand, topic: "winter outfits", photos: [{ jpeg }, { topic: "scarf", jpeg }] }))).json();
    expect(ok.basedOn).toBe("topic");
    expect(ok.pins[1].alt_text).toBe("Scarf");
    const none = await POST(req({ workspace: "fashion", brand, photos: [{ jpeg }] }));
    expect(none.status).toBe(422);
  });
});
