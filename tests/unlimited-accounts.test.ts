import { beforeEach, describe, expect, it } from "vitest";
import { LocalStore, type KeyValue } from "@/lib/store/local";
import { isWorkspaceKind, labelFromSlug, slugify, uniqueSlug } from "@/lib/types";
import { WorkspaceSlug } from "@/lib/workspaces/schema";
import { sampleBoardsFor } from "@/lib/boards/automation";

class MemoryKV implements KeyValue {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const draft = { angle: "a", concept: "c", title: "t", description: "d", tags: ["x"], alt_text: "alt", image_prompt: "p", idea: "i", batch_id: "b", category_id: null, source: "demo" as const };

describe("account slugs", () => {
  it("turns names into URL-safe slugs", () => {
    expect(slugify("Modest Fashion PK!")).toBe("modest-fashion-pk");
    expect(slugify("Café Recipes")).toBe("cafe-recipes");
    expect(slugify("اردو")).toBe("account");
    expect(isWorkspaceKind(slugify("x".repeat(80)))).toBe(true);
  });
  it("keeps slugs unique per user", () => {
    expect(uniqueSlug("Recipes", ["recipes", "recipes-2"])).toBe("recipes-3");
    expect(uniqueSlug("Fashion", [])).toBe("fashion");
  });
  it("accepts any valid slug in requests, not just fashion/macro", () => {
    expect(WorkspaceSlug.safeParse("my-recipes-2").success).toBe(true);
    expect(WorkspaceSlug.safeParse("../etc").success).toBe(false);
    expect(WorkspaceSlug.safeParse("Bad Slug").success).toBe(false);
  });
  it("has sample boards for any account in demo mode", () => {
    expect(sampleBoardsFor("abaya-fashion").length).toBeGreaterThan(0);
    expect(sampleBoardsFor("kitchen").length).toBeGreaterThan(0);
  });
});

describe("LocalStore: unlimited accounts", () => {
  let store: LocalStore;
  let kv: MemoryKV;
  beforeEach(() => { kv = new MemoryKV(); store = new LocalStore(kv); });

  it("starts with the two starter accounts", async () => {
    expect((await store.listWorkspaces()).map((w) => w.kind)).toEqual(["fashion", "macro"]);
  });

  it("adds more than two accounts, each with its own data", async () => {
    const a = await store.createWorkspace("Easy Recipes", "macro");
    const b = await store.createWorkspace("Easy Recipes", "macro");
    const c = await store.createWorkspace("Abaya Shop", "fashion");
    expect([a.kind, b.kind, c.kind]).toEqual(["easy-recipes", "easy-recipes-2", "abaya-shop"]);
    expect((await store.listWorkspaces()).length).toBe(5);
    expect(labelFromSlug("abaya-shop")).toBe("Abaya Shop");
    expect((await store.listCategories(c.id)).length).toBe(10);
    expect((await store.listCategories(a.id)).length).toBe(40);
    await store.saveDrafts(a.id, [draft]);
    expect(await store.listDrafts(a.id)).toHaveLength(1);
    expect(await store.listDrafts(b.id)).toHaveLength(0);
    expect((await store.getWorkspace("abaya-shop")).niche).toBe("fashion");
  });

  it("deletes an account and its data, but never the last one", async () => {
    const a = await store.createWorkspace("Travel", "macro");
    await store.saveDrafts(a.id, [draft]);
    await store.deleteWorkspace(a.id);
    expect((await store.listWorkspaces()).map((w) => w.kind)).toEqual(["fashion", "macro"]);
    await expect(store.getWorkspace("travel")).rejects.toThrow(/Unknown workspace/);
    // Same name again starts empty.
    const again = await store.createWorkspace("Travel", "macro");
    expect(await store.listDrafts(again.id)).toHaveLength(0);
    await store.deleteWorkspace(again.id);
    await store.deleteWorkspace((await store.getWorkspace("fashion")).id);
    await expect(store.deleteWorkspace((await store.getWorkspace("macro")).id)).rejects.toThrow(/at least one/);
  });

  it("keeps renamed names in the account list", async () => {
    const f = await store.getWorkspace("fashion");
    await store.renameWorkspace(f.id, "Style Diary");
    expect((await store.listWorkspaces())[0].name).toBe("Style Diary");
  });

  it("rejects unknown accounts", async () => {
    await expect(store.getWorkspace("nope")).rejects.toThrow(/Unknown workspace/);
  });
});
