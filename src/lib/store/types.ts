import type { BoardPlan, BoardSettings } from "@/lib/boards/automation";
import type { WorkflowAction } from "@/lib/workflow/transitions";
import type { AuditEvent, BrandSettings, Category, DraftContent, DraftVersion, PinDraft, Workspace, WorkspaceKind, ContentSource } from "@/lib/types";

export type DraftPatch = Partial<DraftContent> & { link?: string | null; archived_at?: string | null; category_id?: string | null };

export interface TransitionOptions {
  boardId?: string;
  boardName?: string;
  runAt?: string;
  note?: string;
}

export interface NewDraft extends DraftContent {
  idea: string;
  batch_id: string;
  category_id: string | null;
  source: ContentSource;
  /** Destination URL (blog post, product page). */
  link?: string | null;
  /** Set when this draft is an intentional copy of another. */
  duplicate_of?: string | null;
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
  /** Adds a category, or a sub-category when parentId is given (same workspace only). */
  addCategory(workspaceId: string, name: string, parentId?: string | null): Promise<Category>;
  deleteCategory(workspaceId: string, id: string): Promise<void>;
  listDrafts(workspaceId: string): Promise<PinDraft[]>;
  saveDrafts(workspaceId: string, drafts: NewDraft[]): Promise<PinDraft[]>;
  updateDraft(workspaceId: string, id: string, patch: DraftPatch): Promise<PinDraft>;
  deleteDraft(workspaceId: string, id: string): Promise<void>;
  /** Re-read one draft (e.g. after the server attached an image). */
  getDraft(workspaceId: string, id: string): Promise<PinDraft>;
  /** Demo storage only: the server can't write browser storage, so the client records the image. */
  setImage(workspaceId: string, id: string, image: Pick<PinDraft, "image_status" | "image_path" | "image_source">): Promise<PinDraft>;
  /** A URL the browser can display for a draft's image. */
  imageUrl(draft: PinDraft): Promise<string | null>;
  /** Moves a draft through the approval workflow. Live actions need Supabase + Pinterest. */
  transition(workspaceId: string, id: string, action: WorkflowAction, opts?: TransitionOptions): Promise<PinDraft>;
  audit(workspaceId: string, draftId: string): Promise<AuditEvent[]>;
  /** Stores a brand logo; returns the value to keep in the pin template (storage path or data URL). */
  uploadLogo(workspaceId: string, file: File): Promise<string>;
  /** A URL the browser can display for a stored logo value. */
  logoUrl(logo: string | null): Promise<string | null>;
  /** Renames the workspace's display name (e.g. "Macro" → "Home & Life"). */
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>;
  /** Copies a draft (text, link, category) as a new draft linked to the original. */
  duplicateDraft(workspaceId: string, id: string): Promise<PinDraft>;
  /** Earlier versions of a draft's text, newest first. */
  listVersions(workspaceId: string, draftId: string): Promise<DraftVersion[]>;
  /** Workspace activity log (workflow, publishing, autopilot), newest first. */
  listActivity(workspaceId: string, limit?: number): Promise<AuditEvent[]>;
  /** Board automation mode, rules and bulk keyword plan (spec 11). */
  getBoardSettings(workspaceId: string): Promise<BoardSettings>;
  saveBoardSettings(workspaceId: string, settings: BoardSettings): Promise<void>;
  /** The planned board for each pin. Publishing still re-checks the board on the server. */
  listBoardPlans(workspaceId: string): Promise<BoardPlan[]>;
  saveBoardPlans(workspaceId: string, plans: BoardPlan[]): Promise<void>;
  deleteBoardPlan(workspaceId: string, draftId: string): Promise<void>;
}
