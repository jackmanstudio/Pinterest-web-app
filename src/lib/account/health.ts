import { reviewDraft } from "@/lib/drafts/quality";
import { libraryDuplicates } from "@/lib/library/filter";
import type { BrandSettings, DraftStatus, PinDraft } from "@/lib/types";

export interface Recommendation {
  priority: "high" | "medium" | "low";
  text: string;
  /** Section of the workspace that fixes it. */
  href: string;
}

export interface WorkspaceHealth {
  total: number;
  byStatus: Record<DraftStatus, number>;
  archived: number;
  madeLast7Days: number;
  publishedLast30Days: number;
  scheduledNext7Days: number;
  noImage: number;
  noLink: number;
  lowQuality: number;
  duplicates: number;
  lastPublishedAt: string | null;
  recommendations: Recommendation[];
}

const DAY = 86_400_000;

/**
 * Per-workspace health summary for the overview (spec 28.2/28.3), built only
 * from the app's own data. Recommendations explain what was counted.
 */
export function workspaceHealth(drafts: PinDraft[], brand: BrandSettings | null, now = Date.now()): WorkspaceHealth {
  const live = drafts.filter((d) => !d.archived_at);
  const byStatus: Record<DraftStatus, number> = { draft: 0, in_review: 0, approved: 0, scheduled: 0, published: 0 };
  for (const d of live) byStatus[d.status]++;
  const open = live.filter((d) => d.status !== "published");
  const noImage = open.filter((d) => d.image_status !== "ready").length;
  const noLink = open.filter((d) => !d.link).length;
  const lowQuality = open.filter((d) => reviewDraft(d, { bannedWords: brand?.banned_words }).score < 65).length;
  const duplicates = libraryDuplicates(live).size;
  const published = live.filter((d) => d.published_at).map((d) => new Date(d.published_at!).getTime());
  const lastPublished = published.length ? Math.max(...published) : null;
  const h: WorkspaceHealth = {
    total: live.length,
    byStatus,
    archived: drafts.length - live.length,
    madeLast7Days: live.filter((d) => now - new Date(d.created_at).getTime() <= 7 * DAY).length,
    publishedLast30Days: published.filter((t) => now - t <= 30 * DAY).length,
    scheduledNext7Days: live.filter((d) => d.status === "scheduled" && d.scheduled_for && new Date(d.scheduled_for).getTime() - now <= 7 * DAY).length,
    noImage,
    noLink,
    lowQuality,
    duplicates,
    lastPublishedAt: lastPublished ? new Date(lastPublished).toISOString() : null,
    recommendations: [],
  };
  const r = h.recommendations;
  if (!brand?.brand_name || !brand.audience) r.push({ priority: "high", text: "Fill in brand name and audience so every pin is written for the right people.", href: "settings" });
  if (h.total === 0) r.push({ priority: "high", text: "No pins yet. Type a title in the Studio to make your first five.", href: "" });
  if (byStatus.in_review) r.push({ priority: "high", text: `${byStatus.in_review} pin(s) are waiting for your review.`, href: "publish" });
  if (byStatus.approved && !byStatus.scheduled) r.push({ priority: "medium", text: `${byStatus.approved} approved pin(s) are not scheduled yet.`, href: "publish" });
  if (h.scheduledNext7Days === 0 && h.total > 0) r.push({ priority: "medium", text: "Nothing is scheduled for the next 7 days. Regular posting keeps the account active.", href: "calendar" });
  if (noImage) r.push({ priority: "medium", text: `${noImage} unpublished pin(s) have no image yet.`, href: "drafts" });
  if (lowQuality) r.push({ priority: "medium", text: `${lowQuality} pin(s) score below 65 on the quality check. Open them to see what to fix.`, href: "drafts" });
  if (duplicates) r.push({ priority: "low", text: `${duplicates} pin(s) look very similar to another pin. Change the angle or archive one.`, href: "drafts" });
  if (noLink) r.push({ priority: "low", text: `${noLink} unpublished pin(s) have no destination link.`, href: "drafts" });
  if (lastPublished && now - lastPublished > 14 * DAY) r.push({ priority: "medium", text: "Nothing published in the last 14 days.", href: "publish" });
  return h;
}
