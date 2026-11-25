"use client";
import { PageTitle } from "./PageTitle";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandSettings, PinDraft, WorkspaceKind } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";
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
  const ideas = seasonalIdeas(kind, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), brand?.focus_keywords ?? []).slice(0, 6);
  const inRange = days.flatMap((d) => items.get(dayKey(d)) ?? []);
  const count = (k: CalendarKind) => inRange.filter((i) => i.kind === k).length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle kind={kind} title="Content" accent="calendar" sub="What is published, scheduled and still in draft, day by day." />
      <div className="au-glass flex flex-wrap items-center gap-3 rounded-2xl p-2.5">
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {(["month", "week", "day"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${view === v ? "bg-white shadow-sm" : "text-zinc-600"}`}>{v}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => move(-1)} className="rounded px-2 py-1 hover:bg-zinc-100" aria-label="Previous">‹</button>
          <span className="min-w-44 text-center text-sm font-medium">{heading}</span>
          <button onClick={() => move(1)} className="rounded px-2 py-1 hover:bg-zinc-100" aria-label="Next">›</button>
          <button onClick={() => setCursor(new Date())} className="ml-1 text-xs underline">Today</button>
        </div>
        <span className="ml-auto text-xs text-zinc-600">
          {count("published")} published · {count("scheduled")} scheduled · {count("created")} not scheduled yet (draft, in review or approved)
        </span>
      </div>

      <div className={`grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 ${view === "day" ? "grid-cols-1" : "grid-cols-7"}`}>
        {view !== "day" && DOW.map((d) => <div key={d} className="bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">{d}</div>)}
        {days.map((d) => {
          const k = dayKey(d);
          const list = items.get(k) ?? [];
          const dim = view === "month" && d.getMonth() !== cursor.getMonth();
          const max = view === "month" ? 3 : 20;
          return (
            <div key={k} className={`flex flex-col gap-1 bg-white p-1.5 ${view === "month" ? "min-h-28" : "min-h-64"} ${dim ? "bg-zinc-50 text-zinc-400" : ""}`}>
              <button onClick={() => { setCursor(d); setView("day"); }} className={`self-start rounded px-1 text-xs ${k === today ? "bg-red-700 font-semibold text-white" : "hover:bg-zinc-100"}`}>
                {d.getDate()}
              </button>
              {list.slice(0, max).map((it) => (
                <Link
                  key={it.draft.id}
                  href={it.kind === "created" ? `/w/${kind}/drafts` : `/w/${kind}/publish`}
                  title={`${KIND_LABEL[it.kind]} · ${STATUS_LABELS[it.draft.status]} · ${it.draft.title}`}
                  className={`truncate rounded border-l-2 px-1 py-0.5 text-[11px] text-zinc-800 ${KIND_STYLE[it.kind]}`}
                >
                  {it.kind !== "created" && `${it.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} `}
                  {it.draft.title}
                </Link>
              ))}
              {list.length > max && <span className="text-[11px] text-zinc-500">+{list.length - max} more</span>}
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
            <Link key={i} href={`/w/${kind}?idea=${encodeURIComponent(i)}`} className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">{i}</Link>
          ))}
        </div>
      </section>
    </div>
  );
}
