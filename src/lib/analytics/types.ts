export const ACCOUNT_METRICS = ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK", "ENGAGEMENT", "ENGAGEMENT_RATE"] as const;
export type AccountMetric = (typeof ACCOUNT_METRICS)[number];

export const METRIC_LABELS: Record<string, string> = {
  IMPRESSION: "Impressions",
  SAVE: "Saves",
  PIN_CLICK: "Pin clicks",
  OUTBOUND_CLICK: "Outbound clicks",
  ENGAGEMENT: "Engagements",
  ENGAGEMENT_RATE: "Engagement rate",
  SAVE_RATE: "Save rate",
};

export interface DailyPoint {
  date: string;
  status: string | null;
  metrics: Record<string, number>;
}

export interface AccountAnalytics {
  summary: Record<string, number>;
  daily: DailyPoint[];
}

export interface TopPin {
  pin_id: string;
  metrics: Record<string, number>;
}

export interface PublishedPinStats {
  pin_id: string;
  draft_id: string;
  title: string;
  summary: Record<string, number>;
  /** When the pin went live (missing in snapshots saved before this field existed). */
  published_at?: string | null;
  error?: string;
}

export interface TrendKeyword {
  keyword: string;
  pct_growth_wow: number | null;
  pct_growth_mom: number | null;
  pct_growth_yoy: number | null;
}

export interface Snapshot<T> {
  id: string;
  kind: "account" | "top_pins" | "published_pins" | "trends";
  source: string;
  environment: string;
  start_date: string | null;
  end_date: string | null;
  params: Record<string, unknown>;
  data: T;
  fetched_at: string;
}

export interface Insight {
  title: string;
  detail: string;
  evidence: string;
  action: string;
}
