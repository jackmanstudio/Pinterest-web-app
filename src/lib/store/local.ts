import { EMPTY_BRAND, WORKSPACE_LABELS, type BrandSettings, type Category, type DraftContent, type PinDraft, type Workspace, type WorkspaceKind } from "@/lib/types";
import type { NewDraft, Store } from "./types";

/** Starter taxonomy. Macro is intentionally empty until the user defines it. */
export const DEFAULT_CATEGORIES: Record<WorkspaceKind, string[]> = {
  fashion: ["Outfit ideas", "Seasonal trends", "Accessories", "Styling tips", "Capsule wardrobe"],
  macro: [],
};

interface WorkspaceData {
  workspace: Workspace;
  brand: BrandSettings;
  categories: Category[];
  drafts: PinDraft[];
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const uuid = () => crypto.randomUUID();

/**
 * Browser-only Demo store. Each workspace lives under its own storage key, so
 * a read or write for one workspace cannot touch the other.
 */
export class LocalStore implements Store {
  readonly mode = "demo" as const;
  constructor(private readonly kv: KeyValue) {}

  private key(kind: WorkspaceKind) {
    return `pin-ai-studio:v1:workspace:${kind}`;
  }

  private load(kind: WorkspaceKind): WorkspaceData {
    const raw = this.kv.getItem(this.key(kind));
    if (raw) return JSON.parse(raw) as WorkspaceData;
    const data: WorkspaceData = {
      workspace: { id: `demo-${kind}`, kind, name: WORKSPACE_LABELS[kind] },
      brand: { ...EMPTY_BRAND },
      categories: DEFAULT_CATEGORIES[kind].map((name) => ({ id: uuid(), name, parent_id: null })),
      drafts: [],
    };
    this.write(data);
    return data;
  }

  private write(data: WorkspaceData) {
    this.kv.setItem(this.key(data.workspace.kind), JSON.stringify(data));
  }

  private byId(workspaceId: string): WorkspaceData {
    const kind = workspaceId.replace(/^demo-/, "");
    if (kind !== "fashion" && kind !== "macro") throw new Error("Unknown workspace");
    return this.load(kind);
  }

  async getWorkspace(kind: WorkspaceKind) {
    return this.load(kind).workspace;
  }
  async getBrand(workspaceId: string) {
    return this.byId(workspaceId).brand;
  }
  async saveBrand(workspaceId: string, brand: BrandSettings) {
    const d = this.byId(workspaceId);
    d.brand = brand;
    this.write(d);
  }
  async listCategories(workspaceId: string) {
    return this.byId(workspaceId).categories;
  }
  async addCategory(workspaceId: string, name: string) {
    const d = this.byId(workspaceId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name is required");
    if (d.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) throw new Error("Category already exists");
    const cat = { id: uuid(), name: trimmed, parent_id: null };
    d.categories.push(cat);
    this.write(d);
    return cat;
  }
  async deleteCategory(workspaceId: string, id: string) {
    const d = this.byId(workspaceId);
    d.categories = d.categories.filter((c) => c.id !== id);
    d.drafts = d.drafts.map((p) => (p.category_id === id ? { ...p, category_id: null } : p));
    this.write(d);
  }
  async listDrafts(workspaceId: string) {
    return [...this.byId(workspaceId).drafts].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async saveDrafts(workspaceId: string, drafts: NewDraft[]) {
    const d = this.byId(workspaceId);
    const now = new Date().toISOString();
    const saved: PinDraft[] = drafts.map((n) => {
      if (n.category_id && !d.categories.some((c) => c.id === n.category_id)) {
        throw new Error("Category does not belong to this workspace");
      }
      return {
        ...n,
        id: uuid(),
        workspace_id: d.workspace.id,
        image_status: "not_generated",
        image_path: null,
        image_source: null,
        status: "draft",
        created_at: now,
        updated_at: now,
      };
    });
    d.drafts.push(...saved);
    this.write(d);
    return saved;
  }
  async updateDraft(workspaceId: string, id: string, patch: Partial<DraftContent>) {
    const d = this.byId(workspaceId);
    const i = d.drafts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("Draft not found in this workspace");
    d.drafts[i] = { ...d.drafts[i], ...patch, updated_at: new Date().toISOString() };
    this.write(d);
    return d.drafts[i];
  }
  async getDraft(workspaceId: string, id: string) {
    const found = this.byId(workspaceId).drafts.find((p) => p.id === id);
    if (!found) throw new Error("Draft not found in this workspace");
    return found;
  }
  async setImage(workspaceId: string, id: string, image: Pick<PinDraft, "image_status" | "image_path" | "image_source">) {
    const d = this.byId(workspaceId);
    const i = d.drafts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("Draft not found in this workspace");
    d.drafts[i] = { ...d.drafts[i], ...image, updated_at: new Date().toISOString() };
    this.write(d);
    return d.drafts[i];
  }
  async imageUrl(draft: PinDraft) {
    return draft.image_status === "ready" ? draft.image_path : null;
  }
  async deleteDraft(workspaceId: string, id: string) {
    const d = this.byId(workspaceId);
    d.drafts = d.drafts.filter((p) => p.id !== id);
    this.write(d);
  }
}
