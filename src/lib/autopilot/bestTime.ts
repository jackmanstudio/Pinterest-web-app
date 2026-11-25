/**
 * Best posting hours, learned from how your own pins performed by the hour
 * they were posted (in your timezone). Pinterest's API only gives daily
 * analytics, so this uses each pin's creation time and its totals.
 */
export interface PinSample {
  created_at: string;
  saves: number;
  clicks: number;
  outbound: number;
  impressions: number;
}

export interface BestTime {
  hours: number[];
  basis: "data" | "default";
  detail: string;
  samples: number;
}

const WINDOW = 3; // hours per bucket
export const DEFAULT_HOURS = [12, 13, 14, 18, 19, 20, 21, 22, 23];
export const MIN_SAMPLES = 8;

export function localHour(iso: string | Date, timeZone: string): number {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(d);
    return Number(h) % 24;
  } catch {
    return d.getUTCHours();
  }
}

/** Engagement per pin: saves and outbound clicks count most. */
export const pinScore = (p: PinSample) => p.saves * 3 + p.outbound * 3 + p.clicks + p.impressions / 100;

const label = (start: number) => {
  const f = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  return `${f(start)}–${f((start + WINDOW) % 24)}`;
};

export function bestPostingHours(samples: PinSample[], timeZone: string): BestTime {
  const valid = samples.filter((s) => !Number.isNaN(Date.parse(s.created_at)));
  const buckets = new Map<number, number[]>();
  for (const s of valid) {
    const b = Math.floor(localHour(s.created_at, timeZone) / WINDOW) * WINDOW;
    buckets.set(b, [...(buckets.get(b) ?? []), pinScore(s)]);
  }
  const usable = [...buckets.entries()].filter(([, v]) => v.length >= 2);
  if (valid.length < MIN_SAMPLES || usable.length < 3) {
    return {
      hours: DEFAULT_HOURS,
      basis: "default",
      detail: `Using a default midday + evening window until at least ${MIN_SAMPLES} of your pins have stats (now ${valid.length}).`,
      samples: valid.length,
    };
  }
  const ranked = usable
    .map(([start, v]) => ({ start, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);
  const hours = ranked.flatMap((r) => Array.from({ length: WINDOW }, (_, i) => r.start + i)).sort((a, b) => a - b);
  return {
    hours,
    basis: "data",
    detail: `Your pins posted ${ranked.map((r) => label(r.start)).join(", ")} got the most saves and clicks (based on ${valid.length} pins).`,
    samples: valid.length,
  };
}
