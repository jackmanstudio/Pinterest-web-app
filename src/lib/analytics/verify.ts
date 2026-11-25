import type { Insight } from "./types";

/**
 * Builds the set of numbers an insight may quote: every value in the data, in
 * the formats a writer might use (raw, rounded, 1 decimal, as a percentage).
 */
export function allowedNumbers(data: unknown): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Number(n.toFixed(1)), Number(n.toFixed(2)), Number((n * 100).toFixed(1)), Math.round(n * 100)]) out.add(String(v));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) add(Number(v));
  };
  walk(data);
  return out;
}

/** Numbers quoted in text, normalised ("1,284" -> "1284", "12.5%" -> "12.5"). Ignores years and day counts in ranges. */
export function quotedNumbers(text: string): string[] {
  return (text.match(/-?\d[\d,]*(\.\d+)?/g) ?? []).map((m) => String(Number(m.replace(/,/g, ""))));
}

const SAFE = new Set(["0", "1", "2", "3", "4", "5", "7", "10", "30", "90", "100"]);

/** Keeps only insights whose every quoted number exists in the source data. */
export function verifyInsights(insights: Insight[], data: unknown): { kept: Insight[]; dropped: Insight[] } {
  const allowed = allowedNumbers(data);
  const kept: Insight[] = [];
  const dropped: Insight[] = [];
  for (const ins of insights) {
    const nums = quotedNumbers(`${ins.title} ${ins.detail} ${ins.evidence}`);
    const ok = nums.every((n) => allowed.has(n) || SAFE.has(n) || /^20\d\d$/.test(n));
    (ok ? kept : dropped).push(ins);
  }
  return { kept, dropped };
}
