import { beforeEach, describe, expect, it } from "vitest";
import { LocalStore, type KeyValue } from "@/lib/store/local";
import { EMPTY_BRAND } from "@/lib/types";

class MemoryKV implements KeyValue {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const draft = { angle: "a", concept: "c", title: "t", description: "d", tags: ["x"], alt_text: "alt", image_prompt: "p", idea: "i", batch_id: "b", category_id: null, source: "demo" as const };

describe("LocalStore workspace isolation", () => {
  let store: LocalStore;
  let kv: MemoryKV;
  beforeEach(() => { kv = new MemoryKV(); store = new LocalStore(kv); });

  it("keeps Fashion and Macro drafts and settings separate", async () => {
    const f = await store.getWorkspace("fashion");
    const m = await store.getWorkspace("macro");
    await store.saveDrafts(f.id, [draft, draft]);
    await store.saveBrand(f.id, { ...EMPTY_BRAND, brand_name: "Fashion Co" });

    expect(await store.listDrafts(f.id)).toHaveLength(2);
    expect(await store.listDrafts(m.id)).toHaveLength(0);
    expect((await store.getBrand(m.id)).brand_name).toBe("");
    expect([...kv.m.keys()].sort()).toEqual(["pin-ai-studio:v1:workspace:fashion", "pin-ai-studio:v1:workspace:macro"]);
  });

  it("refuses a category from the other workspace", async () => {
    const f = await store.getWorkspace("fashion");
    const m = await store.getWorkspace("macro");
    const fashionCat = (await store.listCategories(f.id))[0];
    await expect(store.saveDrafts(m.id, [{ ...draft, category_id: fashionCat.id }])).rejects.toThrow(/workspace/);
  });

  it("cannot update a draft through the wrong workspace", async () => {
    const f = await store.getWorkspace("fashion");
    const m = await store.getWorkspace("macro");
    const [saved] = await store.saveDrafts(f.id, [draft]);
    await expect(store.updateDraft(m.id, saved.id, { title: "hijack" })).rejects.toThrow(/not found/i);
    expect((await store.listDrafts(f.id))[0].title).toBe("t");
  });

  it("seeds Fashion categories and leaves Macro empty", async () => {
    expect(await store.listCategories((await store.getWorkspace("fashion")).id)).toHaveLength(5);
    expect(await store.listCategories((await store.getWorkspace("macro")).id)).toHaveLength(0);
  });
});

describe("LocalStore images", () => {
  it("records an image only on the draft's own workspace", async () => {
    const store = new LocalStore(new MemoryKV());
    const f = await store.getWorkspace("fashion");
    const m = await store.getWorkspace("macro");
    const [saved] = await store.saveDrafts(f.id, [draft]);
    expect(saved.image_status).toBe("not_generated");
    await expect(store.setImage(m.id, saved.id, { image_status: "ready", image_path: "data:x", image_source: "demo" })).rejects.toThrow();
    const updated = await store.setImage(f.id, saved.id, { image_status: "ready", image_path: "data:x", image_source: "demo" });
    expect(await store.imageUrl(updated)).toBe("data:x");
  });
});
