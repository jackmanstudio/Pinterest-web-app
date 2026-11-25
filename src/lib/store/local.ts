import { EMPTY_BRAND, WORKSPACE_LABELS, type AuditEvent, type BrandSettings, type Category, type PinDraft, type Workspace, type WorkspaceKind } from "@/lib/types";
import { LIVE_ACTIONS, nextStatus, type WorkflowAction } from "@/lib/workflow/transitions";
import type { DraftPatch, NewDraft, Store, TransitionOptions } from "./types";

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
  audit?: (AuditEvent & { draft_id: string })[];
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
        link: n.link ?? null,
        board_id: null,
        board_name: null,
        review_note: null,
        approved_at: null,
        scheduled_for: null,
        published_at: null,
        external_pin_id: null,
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
    if (cur.status === "scheduled" || cur.status === "published") throw new Error(`This pin is ${cur.status} and is locked; cancel the schedule first`);
    // Same rule as the database: editing approved content withdraws the approval.
    const withdraw = cur.status === "approved" ? { status: "draft" as const, approved_at: null } : {};
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
  async deleteDraft(workspaceId: string, id: string) {
    const d = this.byId(workspaceId);
    d.drafts = d.drafts.filter((p) => p.id !== id);
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
