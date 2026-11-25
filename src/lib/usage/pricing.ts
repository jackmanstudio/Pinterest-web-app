/**
 * Estimated list prices in USD per 1M tokens. Estimates only: verify current
 * pricing with the provider. Unknown models fall back to the most expensive
 * known rate so the budget cap errs on the safe side.
 */
export const TEXT_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const FALLBACK = { input: 10, output: 50 };

export function estimateTextCost(model: string | null, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const p = TEXT_PRICES[model] ?? Object.entries(TEXT_PRICES).find(([k]) => model.startsWith(k))?.[1] ?? FALLBACK;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function monthlyBudgetUsd(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 && env.AI_MONTHLY_BUDGET_USD !== undefined && env.AI_MONTHLY_BUDGET_USD !== "" ? v : 10;
}

export function startOfMonthUtc(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
