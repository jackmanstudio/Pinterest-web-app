import { z } from "zod";
import { allowedNumbers, quotedNumbers } from "@/lib/analytics/verify";
import type { TrendKeyword } from "@/lib/analytics/types";
import { pickTrend, pickWinner, type WinnerCandidate } from "@/lib/autopilot/sources";

/**
 * Growth agent: reads the account's stored Pinterest data (top pins, published
 * pin stats, account totals, trends) and proposes new pin ideas. It never
 * publishes: every idea waits for the owner to accept it into the Autopilot
 * queue or dismiss it. Ideas citing numbers or pins that aren't in the data are
 * dropped, the same rule the insights agent uses.
 */

export const GROWTH_SIGNALS = ["top_pin", "trend", "account", "gap"] as const;
export type GrowthSignal = (typeof GROWTH_SIGNALS)[number];

export const MAX_SUGGESTIONS_PER_RUN = 6;
/** No new run while this many suggestions are still waiting for a decision. */
export const MAX_PENDING = 12;

export const GrowthIdeasSchema = z.object({
  ideas: z
    .array(
      z.object({
        idea: z.string(),
        reason: z.string(),
        evidence: z.string(),
        signal: z.enum(GROWTH_SIGNALS),
        ref: z.string().nullable(),
      }),
    )
    .max(10),
});
export type GrowthIdea = z.infer<typeof GrowthIdeasSchema>["ideas"][number];

export interface GrowthPin {
  pin_id: string;
  title: string | null;
  saves: number;
  clicks: number;
  outbound: number;
  impressions?: number;
}

export interface GrowthInput {
  workspace: string;
  brand: { brand_name?: string | null; audience?: string | null; focus_keywords: string[]; banned_words: string[]; language?: string | null };
  account: Record<string, number> | null;
  pins: GrowthPin[];
  trends: TrendKeyword[];
  /** Ideas already queued, made or suggested recently: don't repeat them. */
  recent: string[];
  want: number;
}

export interface GrowthOutput {
  ideas: GrowthIdea[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export const GROWTH_SYSTEM = `You are the growth agent for a Pinterest content studio. You propose NEW pin ideas for one Pinterest account.
Use ONLY the JSON data provided: the account's own pins with their saves/clicks, account totals, and Pinterest trend keywords. Never invent metrics, pins, trends or competitor data.
Each idea is one line a pin writer can turn into pins (3-200 characters, same language as the brand), specific and searchable, not a vague topic.
Base every idea on one signal:
- "top_pin": a fresh angle on one of the account's best pins. Set "ref" to that pin's pin_id exactly.
- "trend": a growing trend keyword that fits the brand. Set "ref" to the keyword exactly.
- "account": a pattern in the account totals. "ref" is null.
- "gap": a closely related search topic the account hasn't covered yet, implied by its best pins or focus keywords. "ref" is null.
"reason" explains in one sentence why this should grow the account. "evidence" names the pin, keyword or metric and value you relied on; every number must appear in the data exactly.
Never repeat or lightly reword an idea from "recent". Never use a banned word. If the data is too thin, return fewer ideas.`;

export function growthUserPrompt(input: GrowthInput): string {
  const data = {
    brand: input.brand,
    account_totals: input.account,
    pins: input.pins.slice(0, 25),
    trends: input.trends.slice(0, 25),
    recent: input.recent.slice(0, 60),
  };
  return `Account: ${input.workspace}\nPropose up to ${input.want} ideas.\n\nData:\n${JSON.stringify(data)}`;
}

const SAFE = new Set(["0", "1", "2", "3", "4", "5", "7", "10", "30", "90", "100"]);

export function normIdea(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tooSimilar(a: string, b: string): boolean {
  const x = normIdea(a), y = normIdea(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wa = new Set(x.split(" ")), wb = new Set(y.split(" "));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size) >= 0.8;
}

/**
 * Keeps ideas that cite only real numbers and real refs, aren't banned, and
 * don't repeat recent or each other. Returns at most `want`.
 */
export function verifyGrowthIdeas(ideas: GrowthIdea[], input: GrowthInput): { kept: GrowthIdea[]; dropped: { idea: GrowthIdea; why: string }[] } {
  const allowed = allowedNumbers({ account: input.account, pins: input.pins, trends: input.trends });
  const pinIds = new Set(input.pins.map((p) => p.pin_id));
  const keywords = new Set(input.trends.map((t) => t.keyword.toLowerCase()));
  const banned = input.brand.banned_words.map((w) => w.toLowerCase().trim()).filter(Boolean);
  const kept: GrowthIdea[] = [];
  const dropped: { idea: GrowthIdea; why: string }[] = [];
  for (const raw of ideas) {
    const idea = { ...raw, idea: raw.idea.trim().slice(0, 500), reason: raw.reason.trim().slice(0, 500), evidence: raw.evidence.trim().slice(0, 500), ref: raw.ref?.trim() || null };
    const why =
      idea.idea.length < 3 ? "too short"
      : !quotedNumbers(`${idea.idea} ${idea.reason} ${idea.evidence}`).every((n) => allowed.has(n) || SAFE.has(n) || /^20\d\d$/.test(n)) ? "quotes a number not in the data"
      : idea.signal === "top_pin" && !(idea.ref && pinIds.has(idea.ref)) ? "unknown pin"
      : idea.signal === "trend" && !(idea.ref && keywords.has(idea.ref.toLowerCase())) ? "unknown trend"
      : banned.some((w) => normIdea(idea.idea).split(" ").includes(normIdea(w)) || (w.includes(" ") && normIdea(idea.idea).includes(normIdea(w)))) ? "uses a banned word"
      : [...input.recent, ...kept.map((k) => k.idea)].some((r) => tooSimilar(r, idea.idea)) ? "repeats a recent idea"
      : kept.length >= input.want ? "over the limit"
      : null;
    if (why) dropped.push({ idea, why });
    else kept.push(idea);
  }
  return { kept, dropped };
}

/** Rule-based ideas used when no text AI is set up. Clearly labelled "Rules" in the UI. */
export function ruleGrowthIdeas(input: GrowthInput): GrowthIdea[] {
  const out: GrowthIdea[] = [];
  const used = new Set<string>();
  const winners: WinnerCandidate[] = input.pins.map((p) => ({ pin_id: p.pin_id, title: p.title, saves: p.saves, clicks: p.clicks, outbound: p.outbound }));
  for (let i = 0; i < 3; i++) {
    const w = pickWinner(winners, used);
    if (!w?.title) break;
    used.add(w.pin_id);
    out.push({
      idea: `${w.title.trim().slice(0, 150)}: a fresh angle`,
      reason: "One of your best pins; a new version on the same topic usually reaches new people.",
      evidence: `Pin "${w.title.trim().slice(0, 80)}": ${w.saves} saves, ${w.outbound} outbound clicks, ${w.clicks} pin clicks.`,
      signal: "top_pin",
      ref: w.pin_id,
    });
  }
  for (let i = 0; i < 3; i++) {
    const t = pickTrend(input.trends, used, input.brand.focus_keywords, true);
    if (!t) break;
    used.add(t.keyword.toLowerCase());
    const g = t.pct_growth_wow ?? t.pct_growth_mom ?? t.pct_growth_yoy;
    out.push({
      idea: t.keyword.trim().slice(0, 200),
      reason: "A growing Pinterest search that fits your focus keywords.",
      evidence: g == null ? `Trend "${t.keyword}".` : `Trend "${t.keyword}": ${g}% growth.`,
      signal: "trend",
      ref: t.keyword,
    });
  }
  return out;
}
