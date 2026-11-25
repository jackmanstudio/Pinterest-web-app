import type { PinDraft } from "@/lib/types";
import { LIMITS } from "@/lib/drafts/validation";

export const PUBLISH_SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write"];
/** Pinterest accepts only these for image_base64 / image_url pins. */
export const PUBLISHABLE_IMAGE_TYPES = ["png", "jpg", "jpeg"];
export const MIN_SCHEDULE_LEAD_MS = 5 * 60_000;

export interface PublishContext {
  connected: boolean;
  connectionActive: boolean;
  grantedScopes: string[];
  boardId: string | null;
}

/** Reasons a draft can't be scheduled or published yet. Empty list = OK. */
export function publishBlockers(d: Pick<PinDraft, "status" | "title" | "description" | "alt_text" | "image_status" | "image_path" | "image_source" | "link" | "external_pin_id">, ctx: PublishContext): string[] {
  const out: string[] = [];
  if (d.status !== "approved") out.push("The pin must be approved first.");
  if (d.external_pin_id) out.push("This pin was already published.");
  if (!d.title.trim()) out.push("Add a title.");
  if (d.title.length > LIMITS.title || d.description.length > LIMITS.description || d.alt_text.length > LIMITS.alt_text) out.push("Some fields are over Pinterest's length limits.");
  if (d.image_status !== "ready" || !d.image_path) out.push("Generate an image first.");
  else if (d.image_source === "demo") out.push("The image is a DEMO placeholder; connect a real image provider and regenerate it.");
  else {
    const ext = d.image_path.split(".").pop()?.toLowerCase() ?? "";
    if (!PUBLISHABLE_IMAGE_TYPES.includes(ext)) out.push("Pinterest only accepts PNG or JPEG images.");
  }
  if (d.link) {
    try {
      const u = new URL(d.link);
      if (u.protocol !== "https:" && u.protocol !== "http:") out.push("The destination link must start with http(s)://");
    } catch {
      out.push("The destination link isn't a valid URL.");
    }
  }
  if (!ctx.connected) out.push("Connect a Pinterest account to this workspace.");
  else if (!ctx.connectionActive) out.push("Reconnect Pinterest (the saved login stopped working).");
  else {
    const missing = PUBLISH_SCOPES.filter((s) => !ctx.grantedScopes.includes(s));
    if (missing.length) out.push(`Reconnect Pinterest to grant publishing permission (${missing.join(", ")}).`);
  }
  if (!ctx.boardId) out.push("Choose a board.");
  return out;
}

export function validateRunAt(runAt: string, now = Date.now()): string | null {
  const t = Date.parse(runAt);
  if (Number.isNaN(t)) return "Pick a valid date and time.";
  if (t < now + MIN_SCHEDULE_LEAD_MS) return "Schedule at least 5 minutes ahead.";
  if (t > now + 180 * 86400_000) return "Schedule within the next 180 days.";
  return null;
}
