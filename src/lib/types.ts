import type { PinStyle } from "@/lib/drafts/angles";
/**
 * Niche template of an account. It only picks starter categories, sample
 * boards and the default image look. Any number of accounts can share one.
 */
export const WORKSPACE_NICHES = ["fashion", "macro"] as const;
export type WorkspaceNiche = (typeof WORKSPACE_NICHES)[number];
export const NICHE_LABELS: Record<WorkspaceNiche, string> = {
  fashion: "Fashion",
  macro: "All topics",
};
export function isWorkspaceNiche(value: unknown): value is WorkspaceNiche {
  return typeof value === "string" && (WORKSPACE_NICHES as readonly string[]).includes(value);
}

/**
 * URL slug of one of the user's accounts (a workspace), e.g. "my-recipes-2".
 * Users start with none and add as many as they like; slugs are unique per user.
 */
export type WorkspaceKind = string;
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const MAX_WORKSPACE_NAME = 60;

export function isWorkspaceKind(value: string): value is WorkspaceKind {
  return WORKSPACE_SLUG_PATTERN.test(value);
}

/** Turns an account name into a URL slug ("My Recipes!" → "my-recipes"). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "account";
}

/** A slug for `name` that isn't in `taken` ("recipes", "recipes-2", ...). */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name).slice(0, 36).replace(/-+$/g, "") || "account";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Best guess of an account's niche when only its slug is known (demo server). */
export function nicheFromSlug(kind: string): WorkspaceNiche {
  return /fashion|style|outfit|wear/.test(kind) ? "fashion" : "macro";
}

const knownNames = new Map<string, string>();
/** Stores account names as they load, so labels show the user's own name. */
export function rememberWorkspaceNames(list: Pick<Workspace, "kind" | "name">[]) {
  for (const w of list) knownNames.set(w.kind, w.name);
}

/** The account's name (once loaded), else a readable name from its slug. */
export function labelFromSlug(kind: string): string {
  const known = knownNames.get(kind);
  if (known) return known;
  return kind.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type DraftStatus = "draft" | "in_review" | "approved" | "scheduled" | "published";
export type ImageStatus = "not_generated" | "pending" | "ready" | "failed";
/** Where a draft's text came from. "demo" must always be visibly labelled. */
export type ContentSource = "demo" | "ai" | "manual";

export interface Workspace {
  id: string;
  /** URL slug, unique per user. */
  kind: WorkspaceKind;
  /** Niche template (starter categories, sample boards, image look). */
  niche: WorkspaceNiche;
  name: string;
}

export interface BrandSettings {
  brand_name: string;
  voice: string;
  audience: string;
  website_url: string;
  focus_keywords: string[];
  banned_words: string[];
  /** Preferred image style, e.g. "editorial photography" (optional). */
  image_style?: string;
  /** Default call to action, e.g. "Save for later" (optional). */
  cta?: string;
  /** Output language for copy, e.g. "English" (optional; never assumed). */
  language?: string;
  /** Market/region for keywords, e.g. "US" or "Pakistan" (optional). */
  region?: string;
  /** Pin design (title overlay, colours, font, logo). Read with readTemplate(). */
  pin_template?: unknown;
}

export const EMPTY_BRAND: BrandSettings = {
  brand_name: "",
  voice: "",
  audience: "",
  website_url: "",
  focus_keywords: [],
  banned_words: [],
  image_style: "",
  cta: "",
  language: "",
  region: "",
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
  /** Destination URL for the pin (optional). */
  link: string | null;
  board_id: string | null;
  board_name: string | null;
  review_note: string | null;
  approved_at: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  external_pin_id: string | null;
  source: ContentSource;
  /** Set when the pin is archived (hidden from the library by default). */
  archived_at?: string | null;
  /** The draft this one was intentionally duplicated from. */
  duplicate_of?: string | null;
  created_at: string;
  updated_at: string;
}

/** An earlier saved copy of a draft's text (version history). */
export interface DraftVersion {
  id: string;
  draft_id: string;
  title: string;
  description: string;
  tags: string[];
  alt_text: string;
  concept: string;
  image_prompt: string;
  link: string | null;
  changed_by: "you" | "autopilot" | "server";
  created_at: string;
}

export interface GenerateRequest {
  workspace: WorkspaceKind;
  idea: string;
  category?: string;
  /** Output language chosen for this batch (e.g. "Urdu"). Empty = brand default / English. */
  language?: string;
  brand: BrandSettings;
  /** Facts read from a source page (URL to pin). The AI must stay true to them. */
  context?: string;
  /** Pin set: mixed angles (default), roundup, comparison, gift guide, curiosity. */
  style?: PinStyle;
}

export interface GenerateResponse {
  source: ContentSource;
  provider: string;
  model: string | null;
  drafts: DraftContent[];
  usage?: { input_tokens: number; output_tokens: number };
  est_cost_usd?: number;
}

export const STATUS_LABELS: Record<DraftStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

export interface AuditEvent {
  id: string;
  target_type?: string;
  action: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
