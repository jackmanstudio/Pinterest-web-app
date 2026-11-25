import type { PinDraft } from "@/lib/types";

export type CalendarKind = "published" | "scheduled" | "created";

export interface CalendarItem {
  draft: PinDraft;
  kind: CalendarKind;
  at: Date;
}

/** Local yyyy-mm-dd key for a date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 6 weeks of days covering the month, starting on Monday. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

/** The 7 days (Mon-Sun) of the week containing `d`. */
export function weekDays(d: Date): Date[] {
  const offset = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset + i));
}

/**
 * Places each pin on the day that matters most: when it went live, else when it
 * is scheduled, else when it was created (a planned draft). Archived pins are skipped.
 */
export function calendarItems(drafts: PinDraft[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>();
  for (const d of drafts) {
    if (d.archived_at) continue;
    const item: CalendarItem = d.published_at
      ? { draft: d, kind: "published", at: new Date(d.published_at) }
      : d.scheduled_for
        ? { draft: d, kind: "scheduled", at: new Date(d.scheduled_for) }
        : { draft: d, kind: "created", at: new Date(d.created_at) };
    const k = dayKey(item.at);
    out.set(k, [...(out.get(k) ?? []), item].sort((a, b) => a.at.getTime() - b.at.getTime()));
  }
  return out;
}
