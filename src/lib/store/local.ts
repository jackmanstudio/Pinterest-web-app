import { defaultCategories } from "@/lib/categories/taxonomy";
import { EMPTY_BRAND, WORKSPACE_LABELS, type AuditEvent, type BrandSettings, type Category, type DraftVersion, type PinDraft, type Workspace, type WorkspaceKind } from "@/lib/types";
import { LIVE_ACTIONS, nextStatus, type WorkflowAction } from "@/lib/workflow/transitions";
import type { DraftPatch, NewDraft, Store, TransitionOptions } from "./types";
import type { ImageCache } from "@/lib/client/imageCache";

/** Starter taxonomy from the spec: Macro gets all 40 categories, Fashion the first ten. */
export const DEFAULT_CATEGORIES: Record<WorkspaceKind, string[]> = {
  fashion: defaultCategories("fashion"),
  macro: defaultCategories("macro"),
};

interface WorkspaceData {
  workspace: Workspace;
  brand: BrandSettings;
  categories: Category[];
  drafts: PinDraft[];
  audit?: (AuditEvent & { draft_id: string })[];
  versions?: DraftVersion[];
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
  /** `images`: where pin images are kept (IndexedDB in the browser). Without it they stay inline. */
  constructor(
    private readonly kv: KeyValue,
    private readonly images: ImageCache | null = null,
  ) {}

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
    try {
      this.kv.setItem(this.key(data.workspace.kind), JSON.stringify(data));
    } catch (e) {
      if ((e as Error).name === "QuotaExceededError" || /quota/i.test((e as Error).message))
        throw new Error("This browser's storage is full. Delete or archive old pins, or connect Supabase to keep everything online.");
      throw e;
    }
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
  async addCategory(workspaceId: string, name: string, parentId: string | null = null) {
    const d = this.byId(workspaceId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name is required");
    if (parentId && !d.categories.some((c) => c.id === parentId)) throw new Error("Parent category does not belong to this workspace");
    if (d.categories.some((c) => c.parent_id === parentId && c.name.toLowerCase() === trimmed.toLowerCase())) throw new Error("Category already exists");
    const cat = { id: uuid(), name: trimmed, parent_id: parentId };
    d.categories.push(cat);
    this.write(d);
    return cat;
  }
  async deleteCategory(workspaceId: string, id: string) {
    const d = this.byId(workspaceId);
    const gone = new Set([id, ...d.categories.filter((c) => c.parent_id === id).map((c) => c.id)]);
    d.categories = d.categories.filter((c) => !gone.has(c.id));
    d.drafts = d.drafts.map((p) => (p.category_id && gone.has(p.category_id) ? { ...p, category_id: null } : p));
    this.write(d);
  }
  /** Moves images saved inline by older versions into IndexedDB, freeing localStorage. */
  private async moveInlineImages(workspaceId: string) {
    if (!this.images) return;
    const d = this.byId(workspaceId);
    const inline = d.drafts.filter((p) => p.image_path?.startsWith("data:"));
    if (!inline.length) return;
    for (const p of inline) {
      const key = `idb:${p.id}:${Date.now()}`;
      await this.images.put(key, p.image_path!);
      p.image_path = key;
    }
    this.write(d);
  }

  async listDrafts(workspaceId: string) {
    await this.moveInlineImages(workspaceId).catch(() => {});
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
        link: n.link ?? null,
        board_id: null,
        board_name: null,
        review_note: null,
        approved_at: null,
        scheduled_for: null,
        published_at: null,
        external_pin_id: null,
        archived_at: null,
        duplicate_of: n.duplicate_of ?? null,
        created_at: now,
        updated_at: now,
      };
    });
    d.drafts.push(...saved);
    this.write(d);
    return saved;
  }
  async updateDraft(workspaceId: string, id: string, patch: DraftPatch) {
    const d = this.byId(workspaceId);
    const i = d.drafts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("Draft not found in this workspace");
    const cur = d.drafts[i];
    // Same rule as the database: editing approved content withdraws the approval.
    if (patch.archived_at && !cur.archived_at && cur.status === "scheduled") throw new Error("Cancel the schedule before archiving this pin");
    const textKeys = ["title", "description", "tags", "alt_text", "concept", "image_prompt", "link"] as const;
    const textChanged = textKeys.some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(cur[k]));
    if (textChanged && (cur.status === "scheduled" || cur.status === "published")) throw new Error(`This pin is ${cur.status} and is locked; cancel the schedule first`);
    if (textChanged) {
      const v: DraftVersion = {
        id: uuid(), draft_id: id, title: cur.title, description: cur.description, tags: cur.tags, alt_text: cur.alt_text,
        concept: cur.concept, image_prompt: cur.image_prompt, link: cur.link, changed_by: "you", created_at: new Date().toISOString(),
      };
      const others = (d.versions ?? []).filter((x) => x.draft_id !== id);
      const mine = [v, ...(d.versions ?? []).filter((x) => x.draft_id === id)].slice(0, 30);
      d.versions = [...others, ...mine];
    }
    const withdraw = textChanged && cur.status === "approved" ? { status: "draft" as const, approved_at: null } : {};
    d.drafts[i] = { ...cur, ...patch, ...withdraw, updated_at: new Date().toISOString() };
    this.write(d);
    return d.drafts[i];
  }
  async getDraft(workspaceId: string, id: string) {
    const found = this.byId(workspaceId).drafts.find((p) => p.id === id);
    if (!found) throw new Error("Draft not found in this workspace");
    return found;
  }
  async setImage(workspaceId: string, id: string, image: Pick<PinDraft, "image_status" | "image_path" | "image_source">) {
    if (this.images && image.image_path?.startsWith("data:")) {
      // Keep the picture in IndexedDB and only a short key in localStorage.
      const key = `idb:${id}:${Date.now()}`;
      await this.images.put(key, image.image_path);
      const old = this.byId(workspaceId).drafts.find((p) => p.id === id)?.image_path;
      if (old?.startsWith("idb:")) await this.images.remove(old).catch(() => {});
      image = { ...image, image_path: key };
    }
    const d = this.byId(workspaceId);
    const i = d.drafts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("Draft not found in this workspace");
    d.drafts[i] = { ...d.drafts[i], ...image, updated_at: new Date().toISOString() };
    this.write(d);
    return d.drafts[i];
  }
  async imageUrl(draft: PinDraft) {
    if (draft.image_status !== "ready" || !draft.image_path) return null;
    if (draft.image_path.startsWith("idb:")) return this.images ? this.images.get(draft.image_path) : null;
    return draft.image_path;
  }
  async transition(workspaceId: string, id: string, action: WorkflowAction, opts: TransitionOptions = {}) {
    if (LIVE_ACTIONS.includes(action) || action === "cancel_schedule") {
      throw new Error("Scheduling and publishing need Supabase and a connected Pinterest account (Demo mode can't publish).");
    }
    const d = this.byId(workspaceId);
    const i = d.drafts.findIndex((p) => p.id === id);
    if (i < 0) throw new Error("Draft not found in this workspace");
    const cur = d.drafts[i];
    const status = nextStatus(cur.status, action);
    const now = new Date().toISOString();
    d.drafts[i] = {
      ...cur,
      status,
      approved_at: status === "approved" ? now : status === "draft" ? null : cur.approved_at,
      review_note: action === "request_changes" ? opts.note ?? null : action === "submit" ? null : cur.review_note,
      updated_at: now,
    };
    d.audit = [...(d.audit ?? []), { id: uuid(), draft_id: id, action, target_id: id, details: { from: cur.status, to: status, ...(opts.note ? { note: opts.note } : {}), demo: true }, created_at: now }];
    this.write(d);
    return d.drafts[i];
  }
  async audit(workspaceId: string, draftId: string) {
    return (this.byId(workspaceId).audit ?? []).filter((e) => e.draft_id === draftId).reverse();
  }
  async renameWorkspace(workspaceId: string, name: string) {
    const d = this.byId(workspaceId);
    const n = name.trim();
    if (!n || n.length > 40) throw new Error("Name must be 1-40 characters");
    d.workspace = { ...d.workspace, name: n };
    this.write(d);
    return d.workspace;
  }
  async duplicateDraft(workspaceId: string, id: string) {
    const src = await this.getDraft(workspaceId, id);
    const [copy] = await this.saveDrafts(workspaceId, [
      {
        angle: src.angle, concept: src.concept, title: src.title, description: src.description, tags: src.tags, alt_text: src.alt_text,
        image_prompt: src.image_prompt, idea: src.idea, batch_id: uuid(), category_id: src.category_id,
        source: src.source === "demo" ? "demo" : "manual", link: src.link, duplicate_of: src.id,
      },
    ]);
    return copy;
  }
  async listVersions(workspaceId: string, draftId: string) {
    return (this.byId(workspaceId).versions ?? []).filter((v) => v.draft_id === draftId);
  }
  async listActivity(workspaceId: string, limit = 200) {
    return [...(this.byId(workspaceId).audit ?? [])].reverse().slice(0, limit).map((e) => ({ ...e, target_type: "pin_draft" }));
  }
  async deleteDraft(workspaceId: string, id: string) {
    const d = this.byId(workspaceId);
    const path = d.drafts.find((p) => p.id === id)?.image_path;
    if (this.images && path?.startsWith("idb:")) await this.images.remove(path).catch(() => {});
    d.drafts = d.drafts.filter((p) => p.id !== id);
    d.versions = (d.versions ?? []).filter((v) => v.draft_id !== id);
    this.write(d);
  }

  async uploadLogo(_workspaceId: string, file: File) {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Could not read the logo file"));
      r.readAsDataURL(file);
    });
  }
  async logoUrl(logo: string | null) {
    return logo;
  }
}
