import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "@/lib/store/supabase";
import { isMissingColumn, isMissingTable } from "@/lib/supabase/compat";

/** A tiny fake of the Supabase query builder for a database WITHOUT migration 0008. */
function oldDatabase() {
  const calls: string[] = [];
  const NEW = ["archived_at", "duplicate_of", "image_style", "cta", "language", "region"];
  const from = (table: string) => {
    let cols = "";
    let payload: unknown = null;
    const b: Record<string, unknown> = {};
    const chain = () => b;
    Object.assign(b, {
      select: (c: string) => ((cols = c), chain()),
      insert: (p: unknown) => ((payload = p), chain()),
      upsert: (p: unknown) => ((payload = p), chain()),
      update: (p: unknown) => ((payload = p), chain()),
      eq: chain, order: chain, limit: chain, single: chain, maybeSingle: chain,
      then: (resolve: (v: unknown) => void) => {
        calls.push(`${table}:${cols}:${JSON.stringify(payload)}`);
        const text = cols + JSON.stringify(payload ?? "");
        const bad = NEW.find((k) => text.includes(k));
        if (bad) return resolve({ data: null, error: { code: "42703", message: `column ${table}.${bad} does not exist` } });
        if (table === "brand_settings" && cols) return resolve({ data: { brand_name: "Old Co", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [] }, error: null });
        return resolve({ data: [{ id: "d1", title: "t" }], error: null });
      },
    });
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, calls };
}

describe("works on a database that hasn't run the newest migration", () => {
  it("recognises missing column/table errors", () => {
    expect(isMissingColumn({ code: "42703", message: "x" })).toBe(true);
    expect(isMissingColumn({ code: "PGRST204", message: "Could not find the 'cta' column" })).toBe(true);
    expect(isMissingTable({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(isMissingColumn({ code: "23505", message: "duplicate key" })).toBe(false);
  });
  it("still lists drafts, reads and saves brand settings", async () => {
    const { db } = oldDatabase();
    const store = new SupabaseStore(db);
    expect(await store.listDrafts("w")).toEqual([{ id: "d1", title: "t" }]);
    expect((await store.getBrand("w")).brand_name).toBe("Old Co");
    await expect(store.saveBrand("w", { brand_name: "A", voice: "", audience: "", website_url: "", focus_keywords: [], banned_words: [], cta: "Save it" })).resolves.toBeUndefined();
  });
  it("explains that Archive needs the database update", async () => {
    const store = new SupabaseStore(oldDatabase().db);
    await expect(store.updateDraft("w", "d1", { archived_at: "2026-11-25T00:00:00Z" })).rejects.toThrow(/0008/);
  });
});

import { LocalStore, type KeyValue } from "@/lib/store/local";
import { memoryImageCache } from "@/lib/client/imageCache";

describe("demo storage keeps images out of localStorage", () => {
  it("stores the picture in the image cache and only a short key in localStorage", async () => {
    const m = new Map<string, string>();
    const kv: KeyValue = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    const store = new LocalStore(kv, memoryImageCache());
    const ws = await store.getWorkspace("fashion");
    const [d] = await store.saveDrafts(ws.id, [{ angle: "a", concept: "c", title: "t", description: "d", tags: ["x"], alt_text: "a", image_prompt: "p", idea: "idea", batch_id: "b", category_id: null, source: "ai" }]);
    const big = `data:image/jpeg;base64,${"A".repeat(200_000)}`;
    const saved = await store.setImage(ws.id, d.id, { image_status: "ready", image_path: big, image_source: "ai" });
    expect(saved.image_path).toMatch(/^idb:/);
    expect([...m.values()].join("").length).toBeLessThan(20_000);
    expect(await store.imageUrl(saved)).toBe(big);
  });
  it("turns a full browser storage into a clear message", async () => {
    const kv: KeyValue = { getItem: () => null, setItem: () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } };
    await expect(new LocalStore(kv).getWorkspace("fashion")).rejects.toThrow(/storage is full/);
  });
});
