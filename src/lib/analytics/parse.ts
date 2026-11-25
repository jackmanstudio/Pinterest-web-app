import type { AccountAnalytics, TopPin, TrendKeyword } from "./types";

/** Pinterest allows analytics up to 90 days back. Returns UTC YYYY-MM-DD dates. */
export function dateRange(days: number, today = new Date()): { start: string; end: string } {
  const d = Math.min(90, Math.max(1, Math.round(days)));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end.getTime() - (d - 1) * 86400_000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

type Raw = Record<string, { summary_metrics?: Record<string, number>; daily_metrics?: { date: string; data_status?: string; metrics?: Record<string, number> }[] }>;

/** GET /user_account/analytics returns { <split key, e.g. "all">: { summary_metrics, daily_metrics } }. */
export function parseAccountAnalytics(raw: unknown): AccountAnalytics {
  const obj = (raw ?? {}) as Raw;
  const first = obj.all ?? Object.values(obj)[0] ?? {};
  return {
    summary: { ...(first.summary_metrics ?? {}) },
    daily: (first.daily_metrics ?? [])
      .map((d) => ({ date: d.date, status: d.data_status ?? null, metrics: { ...(d.metrics ?? {}) } }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function parseTopPins(raw: unknown): TopPin[] {
  const pins = ((raw ?? {}) as { pins?: { pin_id?: string; metrics?: Record<string, number> }[] }).pins ?? [];
  return pins.filter((p) => p.pin_id).map((p) => ({ pin_id: p.pin_id!, metrics: { ...(p.metrics ?? {}) } }));
}

export function parsePinSummary(raw: unknown): Record<string, number> {
  const obj = (raw ?? {}) as Raw;
  const first = obj.all ?? Object.values(obj)[0] ?? {};
  return { ...(first.summary_metrics ?? {}) };
}

export function parseTrends(raw: unknown): TrendKeyword[] {
  const t = ((raw ?? {}) as { trends?: { keyword?: string; pct_growth_wow?: number; pct_growth_mom?: number; pct_growth_yoy?: number }[] }).trends ?? [];
  return t
    .filter((x) => x.keyword)
    .map((x) => ({ keyword: x.keyword!, pct_growth_wow: x.pct_growth_wow ?? null, pct_growth_mom: x.pct_growth_mom ?? null, pct_growth_yoy: x.pct_growth_yoy ?? null }));
}

/** "fetched 5 minutes ago" style freshness. */
export function freshness(fetchedAt: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
