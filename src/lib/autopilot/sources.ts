import type { TrendKeyword } from "@/lib/analytics/types";

/** A pin that did well, with what we know about it. */
export interface WinnerCandidate {
  pin_id: string;
  title: string | null;
  saves: number;
  outbound: number;
  clicks: number;
}

export function pickWinner(candidates: WinnerCandidate[], usedRefs: Set<string>): WinnerCandidate | null {
  return (
    candidates
      .filter((c) => c.title?.trim() && !usedRefs.has(c.pin_id) && c.saves + c.outbound + c.clicks > 0)
      .sort((a, b) => b.saves * 3 + b.outbound * 3 + b.clicks - (a.saves * 3 + a.outbound * 3 + a.clicks))[0] ?? null
  );
}

export function winnerIdea(title: string): string {
  return `New version of our best-performing pin "${title.trim().slice(0, 300)}": same topic, a fresh angle, new wording and a new image.`;
}

export function pickTrend(trends: TrendKeyword[], usedRefs: Set<string>, focusKeywords: string[], requireFocus: boolean): TrendKeyword | null {
  const focus = focusKeywords.map((k) => k.toLowerCase()).filter(Boolean);
  const relevant = (k: string) => !requireFocus || !focus.length || focus.some((f) => k.toLowerCase().includes(f) || f.includes(k.toLowerCase()));
  const growth = (t: TrendKeyword) => t.pct_growth_wow ?? t.pct_growth_mom ?? t.pct_growth_yoy ?? 0;
  return trends.filter((t) => !usedRefs.has(t.keyword.toLowerCase()) && relevant(t.keyword)).sort((a, b) => growth(b) - growth(a))[0] ?? null;
}

export function trendIdea(keyword: string): string {
  return `${keyword.trim().slice(0, 200)} (trending on Pinterest right now)`;
}
