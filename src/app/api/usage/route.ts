import { connection, NextResponse } from "next/server";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { monthlyBudgetUsd } from "@/lib/usage/pricing";

export async function GET() {
  await connection();
  try {
    const ctx = await getRequestContext();
    const [spent, recent] = await Promise.all([ctx.ledger.monthSpendUsd(), ctx.ledger.recent(50)]);
    return NextResponse.json({ ledger: ctx.ledger.mode, budget_usd: monthlyBudgetUsd(), spent_usd: spent, recent });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
