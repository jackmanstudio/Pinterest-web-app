import { pinScore } from "@/lib/autopilot/bestTime";
import { seasonTiming } from "@/lib/seo/seasonality";
import type { PublishedPinStats } from "./types";

/**
 * Pin health check: rates each published pin against your own other pins
 * (not against Pinterest as a whole) and suggests one next step. Every rating
 * comes with the reason, so it can be checked by hand.
 */
export type PinRating = "strong" | "steady" | "weak" | "too_new" | "no_data";
export type PinAction = "repin_fresh" | "refresh_now" | "rework" | "leave" | "wait";

export interface PinHealth {
  pin_id: string;
  draft_id: string;
  title: string;
  rating: PinRating;
  score: number;
  ageDays: number | null;
  reason: string;
  action: PinAction;
  actionNote: string;
}

const DAY = 86_400_000;
/** Pins younger than this are still being shown to new people; judge them later. */
export const SETTLE_DAYS = 14;
/** Strong pins older than this are worth a fresh version (Pinterest favours new images). */
export const EVERGREEN_DAYS = 60;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function auditPins(stats: PublishedPinStats[], now: Date = new Date()): PinHealth[] {
  const rows = stats.map((p) => {
    const m = p.summary ?? {};
    const sample = { created_at: "", saves: m.SAVE ?? 0, clicks: m.PIN_CLICK ?? 0, outbound: m.OUTBOUND_CLICK ?? 0, impressions: m.IMPRESSION ?? 0 };
    const at = p.published_at ? Date.parse(p.published_at) : NaN;
    return { p, s: sample, score: pinScore(sample), ageDays: Number.isNaN(at) ? null : Math.max(0, Math.floor((now.getTime() - at) / DAY)) };
  });
  const settled = rows.filter((r) => !r.p.error && (r.ageDays === null || r.ageDays >= SETTLE_DAYS));
  const mid = median(settled.map((r) => r.score));
  const midImpr = median(settled.map((r) => r.s.impressions));
  const enough = settled.length >= 3;

  return rows.map(({ p, s, score, ageDays }): PinHealth => {
    const base = { pin_id: p.pin_id, draft_id: p.draft_id, title: p.title, score: Math.round(score * 10) / 10, ageDays };
    const season = seasonTiming(p.title, now);
    if (p.error) return { ...base, rating: "no_data", reason: `Pinterest didn't return stats: ${p.error}`, action: "wait", actionNote: "Try Refresh again later." };
    if (ageDays !== null && ageDays < SETTLE_DAYS)
      return { ...base, rating: "too_new", reason: `Live for ${ageDays} day${ageDays === 1 ? "" : "s"}; pins keep finding people for weeks.`, action: "wait", actionNote: `Check again after day ${SETTLE_DAYS}.` };
    const engaged = s.saves + s.clicks + s.outbound;
    const rate = s.impressions ? engaged / s.impressions : 0;
    if (!enough) {
      return { ...base, rating: "steady", reason: `${s.impressions} views, ${engaged} saves and clicks. Need 3+ settled pins to compare.`, action: "leave", actionNote: "Keep posting; ratings appear once there is more to compare." };
    }
    if (score >= 2 * mid && score > 0) {
      const old = ageDays !== null && ageDays >= EVERGREEN_DAYS;
      if (season.status === "ahead")
        return { ...base, rating: "strong", reason: `About ${Math.round(score / Math.max(mid, 0.1))}× your typical pin.`, action: "refresh_now", actionNote: `${season.event!.label} is coming up: post a fresh design of this winner now.` };
      return {
        ...base, rating: "strong", reason: `About ${Math.round(score / Math.max(mid, 0.1))}× your typical pin.`,
        action: old ? "repin_fresh" : "leave",
        actionNote: old ? `Live for ${ageDays} days: a new image of the same idea can reach new people.` : "Doing well; leave it running.",
      };
    }
    const lowReach = s.impressions < Math.max(50, midImpr * 0.25);
    const lowEngage = s.impressions >= 200 && rate < 0.005;
    if (score <= mid * 0.25 || lowReach || lowEngage) {
      const why = lowReach
        ? `Few views (${s.impressions} vs. a typical ${Math.round(midImpr)}): the title, keywords or board may not match what people search.`
        : `Seen ${s.impressions} times but only ${engaged} ${engaged === 1 ? "save or click" : "saves and clicks"} (${(rate * 100).toFixed(1)}%): the image or promise may not grab attention.`;
      const offSeason = season.status === "off" || season.status === "late";
      return {
        ...base, rating: "weak", reason: why,
        action: offSeason ? "wait" : "rework",
        actionNote: offSeason
          ? `It's a ${season.event!.label} pin and that's out of season; judge it again near the date.`
          : lowReach ? "Make a new version with a clearer, keyword-first title and pin it to the best-matching board." : "Make a new version with a bolder image and a more specific headline.",
      };
    }
    return { ...base, rating: "steady", reason: `Close to your typical pin (${s.impressions} views, ${engaged} saves and clicks).`, action: "leave", actionNote: "No change needed." };
  });
}

export const RATING_LABELS: Record<PinRating, string> = { strong: "Strong", steady: "Steady", weak: "Weak", too_new: "Too new to judge", no_data: "No data" };
