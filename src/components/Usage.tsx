"use client";
import { useEffect, useState } from "react";
import type { UsageEntry } from "@/lib/usage/ledger";
import { WORKSPACE_LABELS, type WorkspaceKind } from "@/lib/types";

interface UsageData {
  ledger: "supabase" | "memory" | "browser";
  budget_usd: number;
  spent_usd: number;
  recent: UsageEntry[];
}

export function Usage({ kind }: { kind: WorkspaceKind }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load usage");
        setData(body);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading usage…</p>;

  const pct = data.budget_usd > 0 ? Math.min(100, (data.spent_usd / data.budget_usd) * 100) : 100;
  const rows = data.recent.filter((r) => r.workspace_kind === kind);
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold">AI spend this month (all workspaces)</h1>
        <p className="mt-1 text-2xl font-semibold">
          {usd(data.spent_usd)} <span className="text-base font-normal text-zinc-500">of {usd(data.budget_usd)} budget</span>
        </p>
        <div className="mt-3 h-2 w-full rounded-full bg-zinc-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-2 rounded-full ${pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-zinc-600">
          Paid AI calls are blocked once the budget is reached. Set it with <code>AI_MONTHLY_BUDGET_USD</code> (default $10). Costs are estimates from list prices;
          check your provider dashboard for billing.
        </p>
        {data.ledger !== "supabase" && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            Demo mode: AI calls (text, images, board picks, brand analysis) are counted for this browser only, the last 15 are listed, and the budget applies
            per browser. A real monthly cap across all visitors needs Supabase.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{WORKSPACE_LABELS[kind]} · recent AI calls</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No AI calls in this workspace yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Tokens / images</th>
                  <th className="py-2 pr-3">Est. cost</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</td>
                    <td className="py-2 pr-3">{r.kind}</td>
                    <td className="py-2 pr-3">
                      {r.provider}
                      {r.model ? ` (${r.model})` : ""}
                      {r.source === "demo" && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-900">DEMO</span>}
                    </td>
                    <td className="py-2 pr-3">{r.kind === "text" ? `${r.input_tokens} / ${r.output_tokens}` : `${r.images} image${r.images === 1 ? "" : "s"}`}</td>
                    <td className="py-2 pr-3">{r.est_cost_usd === 0 && r.source === "ai" && r.status === "ok" ? "$0 (free allowance)" : usd(r.est_cost_usd)}</td>
                    <td className={`py-2 ${r.status === "ok" ? "text-emerald-700" : "text-red-700"}`}>{r.status === "ok" ? "OK" : r.error ?? "Error"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
