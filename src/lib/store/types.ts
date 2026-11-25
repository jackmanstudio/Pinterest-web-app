import type { BrandSettings, Category, DraftContent, PinDraft, Workspace, WorkspaceKind, ContentSource } from "@/lib/types";

export interface NewDraft extends DraftContent {
  idea: string;
  batch_id: string;
  category_id: string | null;
  source: ContentSource;
}

/**
 * Data access used by the UI. Every call is scoped to one workspace so
 * Fashion and Macro data can never be read or written together.
 */
export interface Store {
  readonly mode: "supabase" | "demo";
  getWorkspace(kind: WorkspaceKind): Promise<Workspace>;
  getBrand(workspaceId: string): Promise<BrandSettings>;
  saveBrand(workspaceId: string, brand: BrandSettings): Promise<void>;
  listCategories(workspaceId: string): Promise<Category[]>;
  addCategory(workspaceId: string, name: string): Promise<Category>;
  deleteCategory(workspaceId: string, id: string): Promise<void>;
  listDrafts(workspaceId: string): Promise<PinDraft[]>;
  saveDrafts(workspaceId: string, drafts: NewDraft[]): Promise<PinDraft[]>;
  updateDraft(workspaceId: string, id: string, patch: Partial<DraftContent>): Promise<PinDraft>;
  deleteDraft(workspaceId: string, id: string): Promise<void>;
  /** Re-read one draft (e.g. after the server attached an image). */
  getDraft(workspaceId: string, id: string): Promise<PinDraft>;
  /** Demo storage only: the server can't write browser storage, so the client records the image. */
  setImage(workspaceId: string, id: string, image: Pick<PinDraft, "image_status" | "image_path" | "image_source">): Promise<PinDraft>;
  /** A URL the browser can display for a draft's image. */
  imageUrl(draft: PinDraft): Promise<string | null>;
}
