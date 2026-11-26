"use client";
import { useState } from "react";
import { reviewDraft, scoreLabel, type QualityContext, type Severity } from "@/lib/drafts/quality";
import type { DraftContent } from "@/lib/types";

const DOT: Record<Severity, string> = { ok: "bg-emerald-500", info: "bg-sky-500", warning: "bg-amber-500", error: "bg-red-600" };
const WORD: Record<Severity, string> = { ok: "OK", info: "Tip", warning: "Warning", error: "Must fix" };

/** Explainable quality score (copy only). Not a promise of reach or ranking. */
export function QualityPanel({ draft, ctx }: { draft: DraftContent; ctx?: QualityContext }) {
  const [open, setOpen] = useState(false);
  const r = reviewDraft(draft, ctx);
  const tone = r.score >= 85 ? "text-emerald-700" : r.score >= 65 ? "text-zinc-800" : r.score >= 40 ? "text-amber-700" : "text-red-700";
  const issues = r.checks.filter((c) => c.severity !== "ok");
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open}>
        <span>
          <span className="font-medium text-zinc-700">Quality check: </span>
          <span className={`font-semibold ${tone}`}>{r.score}/100 · {scoreLabel(r.score)}</span>
        </span>
        <span className="text-zinc-500">{issues.length ? `${issues.length} note${issues.length === 1 ? "" : "s"}` : "no notes"} {open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1">
          {r.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[c.severity]}`} aria-hidden />
              <span>
                <span className="font-medium">{WORD[c.severity]} · {c.area}:</span> {c.message}
              </span>
            </li>
          ))}
          <li className="mt-1 text-zinc-500">Automatic text checks only. Look at the image yourself; a good score does not guarantee reach.</li>
        </ul>
      )}
    </div>
  );
}

/** Score card for the Pin library: a ring with the score, the label, and the notes on demand. */
export function QualityScoreCard({ draft, ctx }: { draft: DraftContent; ctx?: QualityContext }) {
  const [open, setOpen] = useState(false);
  const r = reviewDraft(draft, ctx);
  const issues = r.checks.filter((c) => c.severity !== "ok");
  const color = r.score >= 85 ? "#34d399" : r.score >= 65 ? "#e5e1ea" : r.score >= 40 ? "#fbbf24" : "#ff5a6e";
  const R = 22;
  const C = 2 * Math.PI * R;
  return (
    <div className="rounded-xl bg-white/[0.05] p-3 ring-1 ring-white/10">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0 -rotate-90" aria-hidden>
          <circle cx="28" cy="28" r={R} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="5" />
          <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(C * r.score) / 100} ${C}`} />
          <text x="28" y="28" textAnchor="middle" dominantBaseline="central" transform="rotate(90 28 28)" fill="#fff" fontSize="15" fontWeight="700">{r.score}</text>
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">Pin score</span>
          <span className="block text-[15px] font-bold text-white">
            {r.score}/100 <span style={{ color }}>· {scoreLabel(r.score)}</span>
          </span>
          <span className="block text-xs text-white/55">
            {issues.length ? `${issues.length} note${issues.length === 1 ? "" : "s"} to look at` : "All checks passed"}
          </span>
        </span>
        <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/[0.08] hover:text-white">{open ? "Hide ▴" : "Details ▾"}</span>
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-3 text-xs text-white/75">
          {r.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[c.severity]}`} aria-hidden />
              <span>
                <span className="font-semibold text-white/90">{WORD[c.severity]} · {c.area}:</span> {c.message}
              </span>
            </li>
          ))}
          <li className="mt-1 text-white/45">Automatic text checks only. Look at the image yourself; a good score does not guarantee reach.</li>
        </ul>
      )}
    </div>
  );
}
