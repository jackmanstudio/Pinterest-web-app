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
