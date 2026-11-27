import { connection, NextResponse } from "next/server";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { monthlyBudgetUsd } from "@/lib/usage/pricing";
import { errorResponse } from "@/lib/server/errors";

export async function GET(request: Request) {
  await connection();
  try {
    const ctx = await getRequestContext();
    const [spent, recent] = await Promise.all([ctx.ledger.monthSpendUsd(), ctx.ledger.recent(50)]);
    return NextResponse.json({ ledger: ctx.ledger.mode, budget_usd: monthlyBudgetUsd(), spent_usd: spent, recent });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err, request, "Could not load usage.");
  }
}
