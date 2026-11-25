import type { UsageLedger } from "./ledger";
import { monthlyBudgetUsd } from "./pricing";

export class BudgetExceededError extends Error {
  constructor(readonly spent: number, readonly budget: number) {
    super(`Monthly AI budget reached ($${spent.toFixed(2)} of $${budget.toFixed(2)}). Raise AI_MONTHLY_BUDGET_USD or wait until next month.`);
  }
}

/** Throws before a paid call if this month's spend has hit the cap. Demo calls are free and always allowed. */
export async function assertWithinBudget(ledger: UsageLedger, paid: boolean, env: Record<string, string | undefined> = process.env) {
  if (!paid) return;
  const budget = monthlyBudgetUsd(env);
  const spent = await ledger.monthSpendUsd();
  if (spent >= budget) throw new BudgetExceededError(spent, budget);
}
