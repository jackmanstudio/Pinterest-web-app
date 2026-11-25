import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET } from "@/lib/ai/image/types";
import { EMPTY_BRAND, type AuditEvent, type BrandSettings, type Category, type PinDraft, type Workspace, type WorkspaceKind } from "@/lib/types";
import type { WorkflowAction } from "@/lib/workflow/transitions";
import type { DraftPatch, NewDraft, Store, TransitionOptions } from "./types";

const DRAFT_COLUMNS =
  "id, workspace_id, category_id, batch_id, idea, angle, concept, title, description, tags, alt_text, image_prompt, image_status, image_path, image_source, status, link, board_id, board_name, review_note, approved_at, scheduled_for, published_at, external_pin_id, source, created_at, updated_at";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("Not found");
  return res.data;
}

/** Supabase-backed store. RLS enforces ownership; every query also filters by workspace_id. */
export class SupabaseStore implements Store {
  readonly mode = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async getWorkspace(kind: WorkspaceKind): Promise<Workspace> {
    return check(await this.db.from("workspaces").select("id, kind, name").eq("kind", kind).single());
  }
  async getBrand(workspaceId: string): Promise<BrandSettings> {
    const res = await this.db
      .from("brand_settings")
      .select("brand_name, voice, audience, website_url, focus_keywords, banned_words")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ?? { ...EMPTY_BRAND };
  }
  async saveBrand(workspaceId: string, brand: BrandSettings) {
    const res = await this.db.from("brand_settings").upsert({ workspace_id: workspaceId, ...brand });
    if (res.error) throw new Error(res.error.message);
  }
  async listCategories(workspaceId: string): Promise<Category[]> {
    return check(await this.db.from("categories").select("id, name, parent_id").eq("workspace_id", workspaceId).order("name"));
  }
  async addCategory(workspaceId: string, name: string): Promise<Category> {
    return check(
      await this.db.from("categories").insert({ workspace_id: workspaceId, name: name.trim() }).select("id, name, parent_id").single(),
    );
  }
  async deleteCategory(workspaceId: string, id: string) {
    const res = await this.db.from("categories").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (res.error) throw new Error(res.error.message);
  }
  async listDrafts(workspaceId: string): Promise<PinDraft[]> {
    return check(
      await this.db.from("pin_drafts").select(DRAFT_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    );
  }
  async saveDrafts(workspaceId: string, drafts: NewDraft[]): Promise<PinDraft[]> {
    const rows = drafts.map((d) => ({ ...d, workspace_id: workspaceId }));
    return check(await this.db.from("pin_drafts").insert(rows).select(DRAFT_COLUMNS));
  }
  async updateDraft(workspaceId: string, id: string, patch: DraftPatch): Promise<PinDraft> {
    return check(
      await this.db.from("pin_drafts").update(patch).eq("workspace_id", workspaceId).eq("id", id).select(DRAFT_COLUMNS).single(),
    );
  }
  async getDraft(workspaceId: string, id: string): Promise<PinDraft> {
    return check(await this.db.from("pin_drafts").select(DRAFT_COLUMNS).eq("workspace_id", workspaceId).eq("id", id).single());
  }
  async setImage(workspaceId: string, id: string): Promise<PinDraft> {
    // The server route already wrote the image; just re-read the row.
    return this.getDraft(workspaceId, id);
  }
  async imageUrl(draft: PinDraft) {
    if (draft.image_status !== "ready" || !draft.image_path) return null;
    const { data, error } = await this.db.storage.from(IMAGE_BUCKET).createSignedUrl(draft.image_path, 60 * 60);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }
  async transition(workspaceId: string, id: string, action: WorkflowAction, opts: TransitionOptions = {}): Promise<PinDraft> {
    const kind = (await this.db.from("workspaces").select("kind").eq("id", workspaceId).single()).data?.kind;
    const res = await fetch("/api/drafts/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: kind, draftId: id, action, ...opts, confirm: true }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Could not update the pin");
    return this.getDraft(workspaceId, id);
  }
  async audit(workspaceId: string, draftId: string): Promise<AuditEvent[]> {
    return check(
      await this.db
        .from("audit_events")
        .select("id, action, target_id, details, created_at")
        .eq("workspace_id", workspaceId)
        .eq("target_id", draftId)
        .order("created_at", { ascending: false })
        .limit(50),
    );
  }
  async deleteDraft(workspaceId: string, id: string) {
    const draft = await this.getDraft(workspaceId, id);
    if (draft.image_path) await this.db.storage.from(IMAGE_BUCKET).remove([draft.image_path]);
    const res = await this.db.from("pin_drafts").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (res.error) throw new Error(res.error.message);
  }
}
