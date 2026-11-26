"use client";
import { PageTitle } from "./PageTitle";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandSettings, PinDraft, WorkspaceKind } from "@/lib/types";
import { STATUS_LABELS, nicheFromSlug } from "@/lib/types";
import { calendarItems, dayKey, monthGrid, weekDays, type CalendarKind } from "@/lib/planning/calendar";
import { seasonalIdeas } from "@/lib/ideas/seasonal";
import { useWorkspace } from "./useWorkspace";

const KIND_STYLE: Record<CalendarKind, string> = {
  published: "border-l-emerald-600 bg-emerald-50",
  scheduled: "border-l-sky-600 bg-sky-50",
  created: "border-l-zinc-400 bg-zinc-50",
};
const KIND_DOT: Record<CalendarKind, string> = { published: "bg-emerald-600", scheduled: "bg-sky-600", created: "bg-zinc-400" };
const KIND_LABEL: Record<CalendarKind, string> = { published: "Published", scheduled: "Scheduled", created: "Draft made" };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Calendar({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error } = useWorkspace(kind);
  const [drafts, setDrafts] = useState<PinDraft[] | null>(null);
  const [brand, setBrand] = useState<BrandSettings | null>(null);
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [cursorState, setCursor] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!store || !workspace) return;
    Promise.all([store.listDrafts(workspace.id), store.getBrand(workspace.id)])
      .then(([d, b]) => {
        setDrafts(d);
        setBrand(b);
        setCursor((c) => c ?? new Date());
      })
      .catch((e: Error) => setErr(e.message));
  }, [store, workspace]);

  const items = useMemo(() => calendarItems(drafts ?? []), [drafts]);
  if (error || err) return <p className="text-red-700">Could not load the calendar: {error ?? err}</p>;
  if (!drafts || !workspace || !cursorState) return <p className="text-zinc-500">Loading calendar…</p>;
  const cursor = cursorState;

  const today = dayKey(new Date());
  const days = view === "month" ? monthGrid(cursor.getFullYear(), cursor.getMonth()) : view === "week" ? weekDays(cursor) : [cursor];
  const move = (n: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + n, 1);
    else d.setDate(d.getDate() + (view === "week" ? 7 : 1) * n);
    setCursor(d);
  };
  const heading =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
        : cursor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const ideas = seasonalIdeas(workspace?.niche ?? nicheFromSlug(kind), new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), brand?.focus_keywords ?? []).slice(0, 6);
  const inRange = days.flatMap((d) => items.get(dayKey(d)) ?? []);
  const count = (k: CalendarKind) => inRange.filter((i) => i.kind === k).length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle kind={kind} title="Content" accent="calendar" sub="What is published, scheduled and still in draft, day by day." />
      <div className="au-glass flex flex-wrap items-center gap-3 rounded-2xl p-2.5">
        <div className="inline-flex h-10 gap-1 rounded-[0.75rem] bg-white/[0.05] p-1 ring-1 ring-white/12" role="radiogroup" aria-label="Calendar view">
          {(["month", "week", "day"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={`rounded-[0.55rem] px-3.5 text-[13px] font-semibold capitalize transition ${view === v ? "bg-white/[0.16] text-white shadow" : "text-white/60 hover:text-white"}`}>{v}</button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-1 sm:flex-none">
          <button onClick={() => move(-1)} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-white/75 hover:bg-white/[0.08] hover:text-white" aria-label="Previous">‹</button>
          <span className="min-w-0 flex-1 text-center text-sm font-semibold sm:min-w-44 sm:flex-none">{heading}</span>
          <button onClick={() => move(1)} className="grid h-9 w-9 place-items-center rounded-lg text-lg text-white/75 hover:bg-white/[0.08] hover:text-white" aria-label="Next">›</button>
          <button onClick={() => setCursor(new Date())} className="ml-1 h-9 rounded-lg bg-white/[0.07] px-3 text-[13px] font-semibold text-white/85 ring-1 ring-white/12 hover:bg-white/[0.12]">Today</button>
        </div>
        <ul className="flex w-full flex-wrap gap-1.5 sm:ml-auto sm:w-auto" aria-label="In this range">
          {([["published", "published"], ["scheduled", "scheduled"], ["created", "not scheduled yet"]] as const).map(([k, label]) => (
            <li key={k} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-white/70 ring-1 ring-white/10" title={k === "created" ? "Draft, in review or approved" : undefined}>
              <span className={`h-2 w-2 rounded-full ${KIND_DOT[k]}`} aria-hidden />
              <span className="font-semibold text-white tabular-nums">{count(k)}</span> {label}
            </li>
          ))}
        </ul>
      </div>

      <div className={`grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 ${view === "day" ? "grid-cols-1" : "grid-cols-7"}`}>
        {view !== "day" && DOW.map((d) => <div key={d} className="bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">{d}</div>)}
        {days.map((d) => {
          const k = dayKey(d);
          const list = items.get(k) ?? [];
          const dim = view === "month" && d.getMonth() !== cursor.getMonth();
          const max = view === "month" ? 3 : 20;
          return (
            <div key={k} className={`flex min-w-0 flex-col gap-1 bg-white p-1.5 ${view === "month" ? "min-h-16 sm:min-h-28" : "min-h-64"} ${dim ? "bg-zinc-50 text-zinc-400" : ""}`}>
              <button onClick={() => { setCursor(d); setView("day"); }} className={`self-start rounded px-1 text-xs ${k === today ? "bg-red-700 font-semibold text-white" : "hover:bg-zinc-100"}`}>
                {d.getDate()}
              </button>
              {view === "month" && list.length > 0 && (
                <span className="flex flex-wrap gap-0.5 sm:hidden" aria-label={`${list.length} pins`}>
                  {list.slice(0, 4).map((it) => <span key={it.draft.id} className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[it.kind]}`} />)}
                  {list.length > 4 && <span className="text-[9px] leading-none text-white/55">+{list.length - 4}</span>}
                </span>
              )}
              {list.slice(0, max).map((it) => (
                <Link
                  key={it.draft.id}
                  href={it.kind === "created" ? `/w/${kind}/drafts` : `/w/${kind}/publish`}
                  title={`${KIND_LABEL[it.kind]} · ${STATUS_LABELS[it.draft.status]} · ${it.draft.title}`}
                  className={`truncate rounded border-l-2 px-1 py-0.5 text-[11px] text-zinc-800 ${KIND_STYLE[it.kind]} ${view === "month" ? "hidden sm:block" : ""}`}
                >
                  {it.kind !== "created" && `${it.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} `}
                  {it.draft.title}
                </Link>
              ))}
              {list.length > max && <span className={`text-[11px] text-zinc-500 ${view === "month" ? "hidden sm:inline" : ""}`}>+{list.length - max} more</span>}
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-3 text-xs text-zinc-600">
        {(Object.keys(KIND_LABEL) as CalendarKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${KIND_DOT[k]}`} />{KIND_LABEL[k]}</span>
        ))}
        <span>Only this workspace&apos;s pins are shown, so nothing is cross-posted.</span>
      </p>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold">Plan ahead: ideas for {new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).toLocaleDateString(undefined, { month: "long" })}</h2>
        <p className="text-xs text-zinc-500">Seasonal calendar ideas (evergreen suggestions, not live trend data). Pins are made only when you click.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ideas.map((i) => (
            <Link key={i} href={`/w/${kind}?idea=${encodeURIComponent(i)}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3.5 py-1.5 text-[13px] font-medium text-white/85 ring-1 ring-white/12 transition hover:bg-white/[0.12] hover:text-white"><span aria-hidden className="text-[#ff9a7a]">+</span> {i}</Link>
          ))}
        </div>
      </section>
    </div>
  );
}
