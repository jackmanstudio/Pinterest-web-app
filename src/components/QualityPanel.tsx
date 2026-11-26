"use client";
import { useState } from "react";
import { reviewDraft, scoreLabel, type QualityCheck, type QualityContext, type Severity } from "@/lib/drafts/quality";
import type { FixResult } from "@/lib/drafts/autofix";
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

export interface ScoreFix {
  /** Run the automatic fix for this pin. */
  onFix: () => void;
  busy?: boolean;
  /** False when there is nothing the fixer can change. */
  available: boolean;
  /** The last fix on this pin, shown as a "what changed" list. */
  result?: FixResult | null;
  onUndo?: () => void;
}

const GROUPS: { sev: Exclude<Severity, "ok">; title: string; badge: string; dot: string; row: string }[] = [
  { sev: "error", title: "Must fix", badge: "bg-[#ff5a6e]/15 text-[#ff8a98] ring-[#ff5a6e]/30", dot: "bg-[#ff5a6e]", row: "border-l-[#ff5a6e]" },
  { sev: "warning", title: "Warnings", badge: "bg-amber-400/15 text-amber-200 ring-amber-400/30", dot: "bg-amber-400", row: "border-l-amber-400" },
  { sev: "info", title: "Tips", badge: "bg-sky-400/15 text-sky-200 ring-sky-400/30", dot: "bg-sky-400", row: "border-l-sky-400" },
];

function Check({ c, row }: { c: QualityCheck; row: string }) {
  return (
    <li className={`rounded-lg border-l-2 bg-white/[0.04] py-2 pl-3 pr-2.5 ${row}`}>
      <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/45">{c.area}</span>
      <span className="block text-[13px] leading-snug text-white/85">{c.message}</span>
    </li>
  );
}

/** Score card for the Pin library: a ring with the score, grouped notes, and a one-click fix. */
export function QualityScoreCard({ draft, ctx, fix }: { draft: DraftContent; ctx?: QualityContext; fix?: ScoreFix }) {
  const [open, setOpen] = useState(Boolean(fix?.result));
  const r = reviewDraft(draft, ctx);
  const issues = r.checks.filter((c) => c.severity !== "ok");
  const good = r.checks.filter((c) => c.severity === "ok" && c.id !== "all-good");
  const color = r.score >= 85 ? "#34d399" : r.score >= 65 ? "#e5e1ea" : r.score >= 40 ? "#fbbf24" : "#ff5a6e";
  const R = 22;
  const C = 2 * Math.PI * R;
  const count = (s: Severity) => issues.filter((c) => c.severity === s).length;
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
          <span className="mt-1 flex flex-wrap gap-1">
            {issues.length === 0 && <span className="text-xs text-emerald-300">All checks passed</span>}
            {GROUPS.filter((g) => count(g.sev)).map((g) => (
              <span key={g.sev} className={`rounded-full px-1.5 py-px text-[10.5px] font-semibold ring-1 ${g.badge}`}>
                {count(g.sev)} {g.sev === "error" ? "must fix" : g.sev === "warning" ? (count(g.sev) === 1 ? "warning" : "warnings") : count(g.sev) === 1 ? "tip" : "tips"}
              </span>
            ))}
          </span>
        </span>
        <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/[0.08] hover:text-white">{open ? "Hide ▴" : "Details ▾"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3">
          {GROUPS.map((g) => {
            const list = issues.filter((c) => c.severity === g.sev);
            if (!list.length) return null;
            return (
              <section key={g.sev} aria-label={g.title}>
                <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/70">
                  <span className={`h-1.5 w-1.5 rounded-full ${g.dot}`} aria-hidden />
                  {g.title} <span className="font-semibold text-white/40">{list.length}</span>
                </h4>
                <ul className="flex flex-col gap-1.5">{list.map((c) => <Check key={c.id} c={c} row={g.row} />)}</ul>
              </section>
            );
          })}
          {good.length > 0 && (
            <ul className="flex flex-col gap-1">
              {good.map((c) => (
                <li key={c.id} className="flex gap-2 text-[12.5px] text-emerald-200/90"><span aria-hidden>✓</span><span>{c.message}</span></li>
              ))}
            </ul>
          )}

          {fix?.result && <FixSummary result={fix.result} onUndo={fix.onUndo} />}

          {fix && issues.length > 0 && (
            <button
              type="button"
              onClick={fix.onFix}
              disabled={fix.busy || !fix.available}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-3 py-2 text-[13px] font-bold text-white shadow-[0_8px_20px_-10px_rgba(255,90,60,0.9)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5L9 20H4v-5z" /><path d="m13 6 5 5" /></svg>
              {fix.busy ? "Fixing…" : fix.available ? "Fix issues" : "Nothing left to fix automatically"}
            </button>
          )}
          <p className="text-[11.5px] leading-snug text-white/40">Automatic text checks only. Look at the image yourself; a good score does not guarantee reach.</p>
        </div>
      )}
    </div>
  );
}

/** "What changed" after a fix: before → after for each field, plus Undo. */
export function FixSummary({ result, onUndo }: { result: FixResult; onUndo?: () => void }) {
  return (
    <div className="rounded-lg bg-emerald-400/[0.07] p-3 ring-1 ring-emerald-400/25">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-bold text-emerald-200">
          Fixed · score {result.before} → {result.after}
        </span>
        {onUndo && <button type="button" onClick={onUndo} className="rounded-md px-2 py-0.5 text-xs font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white">Undo</button>}
      </div>
      {result.changes.length === 0 ? (
        <p className="text-xs text-white/60">Nothing needed changing.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.changes.map((c) => (
            <li key={c.field} className="text-xs">
              <span className="font-semibold text-white/90">{c.field}</span> <span className="text-white/45">· {c.why}</span>
              {c.before && <span className="mt-0.5 block truncate text-white/40 line-through" title={c.before}>{c.before}</span>}
              <span className="mt-0.5 block text-white/80 [overflow-wrap:anywhere]">{c.after}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-white/45">Saved. Change anything with Edit text; the old text is in History.</p>
    </div>
  );
}
