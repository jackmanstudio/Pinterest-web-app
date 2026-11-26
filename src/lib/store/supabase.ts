import { DEFAULT_BOARD_SETTINGS, type BoardPlan, type BoardSettings } from "@/lib/boards/automation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_BUCKET } from "@/lib/ai/image/types";
import { EMPTY_BRAND, isWorkspaceNiche, rememberWorkspaceNames, type AuditEvent, type BrandSettings, type Category, type DraftVersion, type PinDraft, type Workspace, type WorkspaceKind, type WorkspaceNiche } from "@/lib/types";
import type { WorkflowAction } from "@/lib/workflow/transitions";
import type { DraftPatch, NewDraft, Store, TransitionOptions } from "./types";
import { BRAND_BASE_COLUMNS, BRAND_V8_KEYS, isMissingColumn, isMissingTable, NEEDS_BOARD_MIGRATION, NEEDS_MIGRATION, type DbError } from "@/lib/supabase/compat";

type Res<T> = { data: T | null; error: DbError | null };

const LEGACY_DRAFT_COLUMNS =
  "id, workspace_id, category_id, batch_id, idea, angle, concept, title, description, tags, alt_text, image_prompt, image_status, image_path, image_source, status, link, board_id, board_name, review_note, approved_at, scheduled_for, published_at, external_pin_id, source, created_at, updated_at";
const DRAFT_COLUMNS = `${LEGACY_DRAFT_COLUMNS}, archived_at, duplicate_of`;

/** Workspace columns: the URL slug is `kind` in the app, the DB `kind` column is the niche. */
const WS_COLUMNS = "id, kind:slug, niche:kind, name, created_at";
const LEGACY_WS_COLUMNS = "id, kind, niche:kind, name, created_at";
type WsRow = { id: string; kind: string; niche: string; name: string };
const toWorkspace = (r: WsRow): Workspace => ({ id: r.id, kind: r.kind, niche: isWorkspaceNiche(r.niche) ? r.niche : "macro", name: r.name });

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("Not found");
  return res.data;
}

/** Supabase-backed store. RLS enforces ownership; every query also filters by workspace_id. */
export class SupabaseStore implements Store {
  readonly mode = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  /** Set once the database turns out not to have migration 0008 yet. */
  private legacy = false;

  /** Runs a draft query with the new columns, falling back to the old ones on an older database. */
  private async drafts<T>(q: (cols: string) => PromiseLike<Res<T>>): Promise<T> {
    if (!this.legacy) {
      const res = await q(DRAFT_COLUMNS);
      if (!isMissingColumn(res.error)) return check(res);
      this.legacy = true;
    }
    return check(await q(LEGACY_DRAFT_COLUMNS));
  }

  /** Set once the database turns out not to have migration 0013 (account slugs) yet. */
  private legacyWorkspaces = false;

  private async workspaceQuery<T>(q: (cols: string, slugCol: string) => PromiseLike<Res<T>>): Promise<T> {
    if (!this.legacyWorkspaces) {
      const res = await q(WS_COLUMNS, "slug");
      if (!isMissingColumn(res.error)) return check(res);
      this.legacyWorkspaces = true;
    }
    return check(await q(LEGACY_WS_COLUMNS, "kind"));
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.workspaceQuery<WsRow[]>((cols) => this.db.from("workspaces").select(cols).order("created_at").returns<WsRow[]>());
    const list = rows.map(toWorkspace);
    rememberWorkspaceNames(list);
    return list;
  }
  async getWorkspace(kind: WorkspaceKind): Promise<Workspace> {
    const w = toWorkspace(await this.workspaceQuery<WsRow>((cols, slugCol) => this.db.from("workspaces").select(cols).eq(slugCol, kind).single<WsRow>()));
    rememberWorkspaceNames([w]);
    return w;
  }
  async createWorkspace(name: string, niche: WorkspaceNiche): Promise<Workspace> {
    const { data, error } = await this.db.rpc("create_workspace", { p_name: name.trim(), p_niche: niche });
    if (error) {
      if (/create_workspace/.test(error.message) || error.code === "PGRST202") throw new Error("Adding accounts needs a database update. Run supabase/migrations/0013_unlimited_accounts.sql in the Supabase SQL editor.");
      throw new Error(error.message);
    }
    const row = data as { id: string; slug: string; kind: string; name: string };
    const w = toWorkspace({ id: row.id, kind: row.slug, niche: row.kind, name: row.name });
    rememberWorkspaceNames([w]);
    return w;
  }
  async deleteWorkspace(workspaceId: string): Promise<void> {
    const { error } = await this.db.rpc("delete_workspace", { p_workspace: workspaceId });
    if (error) throw new Error(error.message);
  }
  async getBrand(workspaceId: string): Promise<BrandSettings> {
    const sel = (cols: string) => this.db.from("brand_settings").select(cols).eq("workspace_id", workspaceId).maybeSingle();
    let res = await sel(`${BRAND_BASE_COLUMNS}, ${BRAND_V8_KEYS.join(", ")}, pin_template`);
    if (isMissingColumn(res.error)) res = await sel(`${BRAND_BASE_COLUMNS}, pin_template`);
    if (isMissingColumn(res.error)) res = await sel(BRAND_BASE_COLUMNS);
    if (res.error) throw new Error(res.error.message);
    return { ...EMPTY_BRAND, ...((res.data as Partial<BrandSettings> | null) ?? {}) };
  }
  async saveBrand(workspaceId: string, brand: BrandSettings) {
    let res = await this.db.from("brand_settings").upsert({ workspace_id: workspaceId, ...brand });
    if (isMissingColumn(res.error)) {
      // Older database: save everything it knows about.
      const older: Record<string, unknown> = { workspace_id: workspaceId, ...brand };
      for (const k of BRAND_V8_KEYS) delete older[k];
      res = await this.db.from("brand_settings").upsert(older);
    }
    if (res.error) throw new Error(res.error.message);
  }
  async listCategories(workspaceId: string): Promise<Category[]> {
    return check(await this.db.from("categories").select("id, name, parent_id").eq("workspace_id", workspaceId).order("name"));
  }
  async addCategory(workspaceId: string, name: string, parentId: string | null = null): Promise<Category> {
    return check(
      await this.db.from("categories").insert({ workspace_id: workspaceId, name: name.trim(), parent_id: parentId }).select("id, name, parent_id").single(),
    );
  }
  async deleteCategory(workspaceId: string, id: string) {
    const res = await this.db.from("categories").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (res.error) throw new Error(res.error.message);
  }
  async listDrafts(workspaceId: string): Promise<PinDraft[]> {
    return this.drafts((cols) => this.db.from("pin_drafts").select(cols).eq("workspace_id", workspaceId).order("created_at", { ascending: false })) as unknown as Promise<PinDraft[]>;
  }
  async saveDrafts(workspaceId: string, drafts: NewDraft[]): Promise<PinDraft[]> {
    const rows = drafts.map((d) => ({ ...d, workspace_id: workspaceId }));
    const first = await this.db.from("pin_drafts").insert(rows).select(this.legacy ? LEGACY_DRAFT_COLUMNS : DRAFT_COLUMNS);
    if (!isMissingColumn(first.error)) return check(first) as unknown as PinDraft[];
    this.legacy = true;
    // Older database: no duplicate link column yet.
    const older = rows.map(({ duplicate_of: _dup, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
    return check(await this.db.from("pin_drafts").insert(older).select(LEGACY_DRAFT_COLUMNS)) as unknown as PinDraft[];
  }
  async updateDraft(workspaceId: string, id: string, patch: DraftPatch): Promise<PinDraft> {
    const res = await this.db.from("pin_drafts").update(patch).eq("workspace_id", workspaceId).eq("id", id).select(this.legacy ? LEGACY_DRAFT_COLUMNS : DRAFT_COLUMNS).single();
    if (!isMissingColumn(res.error)) return check(res) as unknown as PinDraft;
    this.legacy = true;
    if ("archived_at" in patch) throw new Error(NEEDS_MIGRATION);
    return check(await this.db.from("pin_drafts").update(patch).eq("workspace_id", workspaceId).eq("id", id).select(LEGACY_DRAFT_COLUMNS).single()) as unknown as PinDraft;
  }
  async getDraft(workspaceId: string, id: string): Promise<PinDraft> {
    return this.drafts((cols) => this.db.from("pin_drafts").select(cols).eq("workspace_id", workspaceId).eq("id", id).single()) as unknown as Promise<PinDraft>;
  }
  async setImage(workspaceId: string, id: string): Promise<PinDraft> {
    // The server route already wrote the image; just re-read the row.
    return this.getDraft(workspaceId, id);
  }
  async uploadLogo(workspaceId: string, file: File) {
    const ext = file.type === "image/png" ? "png" : "jpg";
    const path = `${workspaceId}/brand/logo-${Date.now()}.${ext}`;
    const { error } = await this.db.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }
  async logoUrl(logo: string | null) {
    if (!logo) return null;
    if (logo.startsWith("data:")) return logo;
    const { data, error } = await this.db.storage.from(IMAGE_BUCKET).createSignedUrl(logo, 60 * 60);
    return error ? null : data.signedUrl;
  }
  async imageUrl(draft: PinDraft) {
    if (draft.image_status !== "ready" || !draft.image_path) return null;
    const { data, error } = await this.db.storage.from(IMAGE_BUCKET).createSignedUrl(draft.image_path, 60 * 60);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }
  async transition(workspaceId: string, id: string, action: WorkflowAction, opts: TransitionOptions = {}): Promise<PinDraft> {
    const kind = (await this.workspaceQuery<WsRow>((cols) => this.db.from("workspaces").select(cols).eq("id", workspaceId).single<WsRow>())).kind;
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
  async renameWorkspace(workspaceId: string, name: string): Promise<Workspace> {
    const w = toWorkspace(await this.workspaceQuery<WsRow>((cols) => this.db.from("workspaces").update({ name: name.trim() }).eq("id", workspaceId).select(cols).single<WsRow>()));
    rememberWorkspaceNames([w]);
    return w;
  }
  async duplicateDraft(workspaceId: string, id: string): Promise<PinDraft> {
    const d = await this.getDraft(workspaceId, id);
    const [copy] = await this.saveDrafts(workspaceId, [
      {
        angle: d.angle, concept: d.concept, title: d.title, description: d.description, tags: d.tags, alt_text: d.alt_text,
        image_prompt: d.image_prompt, idea: d.idea, batch_id: crypto.randomUUID(), category_id: d.category_id,
        source: d.source === "demo" ? "demo" : "manual", link: d.link, duplicate_of: d.id,
      },
    ]);
    return copy;
  }
  async listVersions(workspaceId: string, draftId: string): Promise<DraftVersion[]> {
    const res = await this.db
        .from("pin_draft_versions")
        .select("id, draft_id, title, description, tags, alt_text, concept, image_prompt, link, changed_by, created_at")
        .eq("workspace_id", workspaceId)
        .eq("draft_id", draftId)
        .order("created_at", { ascending: false })
        .limit(30);
    if (isMissingTable(res.error)) throw new Error(NEEDS_MIGRATION);
    return check(res) as DraftVersion[];
  }
  async getBoardSettings(workspaceId: string): Promise<BoardSettings> {
    const sel = (cols: string) => this.db.from("board_settings").select(cols).eq("workspace_id", workspaceId).maybeSingle();
    let res = await sel("mode, manual_board_id, manual_board_name, rules, keyword_plan, board_categories");
    // Database without migration 0013: no board categories yet.
    if (isMissingColumn(res.error)) res = await sel("mode, manual_board_id, manual_board_name, rules, keyword_plan");
    if (isMissingTable(res.error)) return { ...DEFAULT_BOARD_SETTINGS };
    if (res.error) throw new Error(res.error.message);
    return { ...DEFAULT_BOARD_SETTINGS, ...((res.data ?? {}) as Partial<BoardSettings>) };
  }
  async saveBoardSettings(workspaceId: string, s: BoardSettings) {
    const row = { workspace_id: workspaceId, ...s, board_categories: s.board_categories ?? {}, updated_at: new Date().toISOString() };
    let res = await this.db.from("board_settings").upsert(row, { onConflict: "workspace_id" });
    if (isMissingColumn(res.error)) {
      if (Object.keys(s.board_categories ?? {}).length) throw new Error("Saving board categories needs a database update. Run supabase/migrations/0013_unlimited_accounts.sql in the Supabase SQL editor.");
      const { board_categories: _skip, ...older } = row;
      void _skip;
      res = await this.db.from("board_settings").upsert(older, { onConflict: "workspace_id" });
    }
    if (isMissingTable(res.error)) throw new Error(NEEDS_BOARD_MIGRATION);
    if (res.error) throw new Error(res.error.message);
  }
  async listBoardPlans(workspaceId: string): Promise<BoardPlan[]> {
    const res = await this.db.from("draft_board_plans").select("draft_id, board_id, board_name, category, reason, method, confidence").eq("workspace_id", workspaceId);
    if (isMissingTable(res.error)) return [];
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []) as BoardPlan[];
  }
  async saveBoardPlans(workspaceId: string, plans: BoardPlan[]) {
    if (!plans.length) return;
    const rows = plans.map((p) => ({ ...p, workspace_id: workspaceId, reason: p.reason?.slice(0, 300) ?? null, category: p.category?.slice(0, 80) ?? null }));
    const res = await this.db.from("draft_board_plans").upsert(rows, { onConflict: "draft_id" });
    if (isMissingTable(res.error)) throw new Error(NEEDS_BOARD_MIGRATION);
    if (res.error) throw new Error(res.error.message);
  }
  async deleteBoardPlan(workspaceId: string, draftId: string) {
    const res = await this.db.from("draft_board_plans").delete().eq("workspace_id", workspaceId).eq("draft_id", draftId);
    if (res.error && !isMissingTable(res.error)) throw new Error(res.error.message);
  }
  async listActivity(workspaceId: string, limit = 200): Promise<AuditEvent[]> {
    return check(
      await this.db
        .from("audit_events")
        .select("id, action, target_type, target_id, details, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit),
    );
  }
  async deleteDraft(workspaceId: string, id: string) {
    const draft = await this.getDraft(workspaceId, id);
    if (draft.image_path) await this.db.storage.from(IMAGE_BUCKET).remove([draft.image_path]);
    const res = await this.db.from("pin_drafts").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (res.error) throw new Error(res.error.message);
  }
}
