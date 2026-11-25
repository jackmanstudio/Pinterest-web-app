export const WORKSPACE_KINDS = ["fashion", "macro"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export function isWorkspaceKind(value: string): value is WorkspaceKind {
  return (WORKSPACE_KINDS as readonly string[]).includes(value);
}

export const WORKSPACE_LABELS: Record<WorkspaceKind, string> = {
  fashion: "Fashion",
  macro: "Macro",
};

export type DraftStatus = "draft" | "in_review" | "approved" | "scheduled" | "published";
export type ImageStatus = "not_generated" | "pending" | "ready" | "failed";
/** Where a draft's text came from. "demo" must always be visibly labelled. */
export type ContentSource = "demo" | "ai" | "manual";

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
}

export interface BrandSettings {
  brand_name: string;
  voice: string;
  audience: string;
  website_url: string;
  focus_keywords: string[];
  banned_words: string[];
}

export const EMPTY_BRAND: BrandSettings = {
  brand_name: "",
  voice: "",
  audience: "",
  website_url: "",
  focus_keywords: [],
  banned_words: [],
};

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

/** The editable content of one pin draft. */
export interface DraftContent {
  angle: string;
  concept: string;
  title: string;
  description: string;
  tags: string[];
  alt_text: string;
  image_prompt: string;
}

export interface PinDraft extends DraftContent {
  id: string;
  workspace_id: string;
  category_id: string | null;
  batch_id: string;
  idea: string;
  image_status: ImageStatus;
  /** Storage path (Supabase) or inline data URL (Demo storage). */
  image_path: string | null;
  image_source: ContentSource | null;
  status: DraftStatus;
  source: ContentSource;
  created_at: string;
  updated_at: string;
}

export interface GenerateRequest {
  workspace: WorkspaceKind;
  idea: string;
  category?: string;
  brand: BrandSettings;
}

export interface GenerateResponse {
  source: ContentSource;
  provider: string;
  model: string | null;
  drafts: DraftContent[];
  usage?: { input_tokens: number; output_tokens: number };
  est_cost_usd?: number;
}
