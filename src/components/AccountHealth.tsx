import Link from "./NavLink";
import type { WorkspaceHealth } from "@/lib/account/health";
import { STATUS_LABELS, type DraftStatus } from "@/lib/types";

const PRIORITY = {
  high: { pill: "bg-red-500/15 text-red-200 ring-red-400/30", bar: "bg-red-400" },
  medium: { pill: "bg-amber-300/10 text-amber-200 ring-amber-300/30", bar: "bg-amber-300" },
  low: { pill: "bg-white/[0.06] text-white/70 ring-white/15", bar: "bg-white/40" },
};

const STATUS_DOT: Record<DraftStatus, string> = {
  draft: "bg-white/60",
  in_review: "bg-amber-300",
  approved: "bg-sky-400",
  scheduled: "bg-violet-400",
  published: "bg-emerald-400",
};

/** The body of an account card on All accounts: key numbers, pin pipeline and the to-do list. */
export function AccountHealth({ h, base }: { h: WorkspaceHealth | null; base: string }) {
  const main: [string, number | undefined][] = [
    ["Pins", h?.total],
    ["Made this week", h?.madeLast7Days],
    ["Published 30d", h?.publishedLast30Days],
  ];
  const watch: [string, number | undefined, boolean][] = [
    ["Scheduled next 7d", h?.scheduledNext7Days, false],
    ["Without image", h?.noImage, true],
    ["Need fixes", h?.lowQuality, true],
  ];
  const statuses = Object.keys(STATUS_LABELS) as DraftStatus[];
  const inPipeline = h ? statuses.reduce((a, s) => a + (h.byStatus[s] ?? 0), 0) : 0;

  return (
    <div className="relative flex flex-1 flex-col gap-4">
      {/* Key numbers: three big, three small to watch */}
      <div className="overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-white/10">
        <dl className="grid grid-cols-3 divide-x divide-white/[0.08]">
          {main.map(([label, v]) => (
            <div key={label} className="flex flex-col-reverse justify-end gap-1 px-3.5 py-3">
              <dt className="text-[11.5px] font-medium leading-tight text-white/55">{label}</dt>
              <dd className="text-[1.75rem] font-bold leading-none tracking-tight tabular-nums">{v ?? "–"}</dd>
            </div>
          ))}
        </dl>
        <dl className="grid grid-cols-3 divide-x divide-white/[0.08] border-t border-white/[0.08] bg-black/10">
          {watch.map(([label, v, warn]) => (
            <div key={label} className="flex flex-col-reverse gap-0.5 px-3.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <dt className="text-[11.5px] leading-tight text-white/55">{label}</dt>
              <dd className={`text-sm font-bold tabular-nums ${warn && v ? "text-amber-300" : "text-white/85"}`}>{v ?? "–"}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Pin pipeline: a stacked bar and one chip per status */}
      {h && (
        <div className="flex flex-col gap-2">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
            {inPipeline > 0 && statuses.map((s) => (h.byStatus[s] ? <span key={s} className={STATUS_DOT[s]} style={{ width: `${(100 * h.byStatus[s]) / inPipeline}%` }} /> : null))}
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Pins by status">
            {statuses.map((s) => (
              <li key={s} className={`inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] ring-1 ring-white/10 ${h.byStatus[s] ? "text-white/80" : "text-white/40"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]} ${h.byStatus[s] ? "" : "opacity-40"}`} aria-hidden />
                {STATUS_LABELS[s]} <span className="font-semibold tabular-nums">{h.byStatus[s] ?? 0}</span>
              </li>
            ))}
            {h.archived > 0 && (
              <li className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11.5px] text-white/55 ring-1 ring-white/10">
                Archived <span className="font-semibold tabular-nums">{h.archived}</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {/* To-dos */}
      <div className="flex flex-1 flex-col border-t border-white/10 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">What to do next</h3>
          {h && h.recommendations.length > 0 && (
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-semibold text-white/65 ring-1 ring-white/10">{h.recommendations.length}</span>
          )}
        </div>
        {h && h.recommendations.length === 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-500/[0.08] px-3 py-2.5 text-[13px] text-emerald-200 ring-1 ring-emerald-400/20">
            <span aria-hidden>✓</span> All good. Nothing needs attention.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {h?.recommendations.map((r) => (
            <li key={r.text}>
              <Link
                href={`${base}${r.href ? `/${r.href}` : ""}?todo=${r.todo}`}
                className="group relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-white/[0.04] py-2.5 pl-3.5 pr-3 text-[13px] leading-snug text-white/85 ring-1 ring-white/10 transition hover:bg-white/[0.09] hover:ring-white/20"
              >
                <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${PRIORITY[r.priority].bar}`} />
                <span className={`w-[4.2rem] shrink-0 rounded-full py-px text-center text-[10px] font-bold uppercase tracking-wide ring-1 ${PRIORITY[r.priority].pill}`}>{r.priority}</span>
                <span className="min-w-0 flex-1">{r.text}</span>
                <span aria-hidden className="text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
