"use client";
import { useState } from "react";
import { compactNumber } from "@/lib/analytics/parse";
import type { DailyPoint } from "@/lib/analytics/types";

const BAR = "#2370cd"; // sequential blue, step 500 (dataviz reference palette)
const BAR_HOVER = "#1757ac"; // step 600

function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Single-series daily bar chart with per-bar hover tooltip and a table view. */
export function DailyBars({ points, metric, label }: { points: DailyPoint[]; metric: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = points.map((p) => p.metrics[metric] ?? 0);
  const max = niceCeil(Math.max(1, ...values));
  const W = 720;
  const H = 180;
  const padL = 40;
  const padB = 22;
  const innerW = W - padL - 8;
  const innerH = H - padB - 8;
  const slot = innerW / Math.max(1, points.length);
  const bw = Math.max(2, slot - 2); // 2px surface gap between bars
  const ticks = [0, max / 2, max];

  if (points.length === 0) return <p className="text-sm text-zinc-600">No daily data in this range.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-800">{label} per day</h3>
        <button onClick={() => setTable(!table)} className="text-xs text-zinc-600 underline">{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500"><tr><th className="py-1">Date (UTC)</th><th className="py-1">{label}</th><th className="py-1">Data status</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t border-zinc-100"><td className="py-1">{p.date}</td><td className="py-1">{(p.metrics[metric] ?? 0).toLocaleString()}</td><td className="py-1">{p.status ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} per day, ${points[0].date} to ${points[points.length - 1].date}`}>
            {ticks.map((t) => {
              const y = 8 + innerH - (t / max) * innerH;
              return (
                <g key={t}>
                  <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="#e4e4e7" strokeWidth={1} />
                  <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#71717a">{compactNumber(t)}</text>
                </g>
              );
            })}
            {points.map((p, i) => {
              const v = values[i];
              const h = Math.max(v > 0 ? 2 : 0, (v / max) * innerH);
              const x = padL + i * slot + 1;
              const y = 8 + innerH - h;
              const r = Math.min(4, bw / 2, h);
              return (
                <g key={p.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={padL + i * slot} y={8} width={slot} height={innerH} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${y + h} Z`}
                      fill={hover === i ? BAR_HOVER : BAR}
                      opacity={p.status && p.status !== "READY" ? 0.5 : 1}
                    />
                  )}
                </g>
              );
            })}
            <text x={padL} y={H - 6} fontSize={10} fill="#71717a">{points[0].date}</text>
            <text x={W - 8} y={H - 6} fontSize={10} fill="#71717a" textAnchor="end">{points[points.length - 1].date}</text>
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow"
              style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
            >
              <div className="font-medium">{points[hover].date}</div>
              <div>{label}: {values[hover].toLocaleString()}</div>
              {points[hover].status && points[hover].status !== "READY" && <div className="text-zinc-500">Status: {points[hover].status}</div>}
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-zinc-500">Faded bars are days Pinterest marks as still processing or estimated.</p>
    </div>
  );
}
