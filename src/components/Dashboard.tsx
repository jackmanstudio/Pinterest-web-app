"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStore } from "@/lib/store";
import { getDemoUser } from "@/lib/auth/demo";
import { STATUS_LABELS, WORKSPACE_KINDS, WORKSPACE_LABELS, type PinDraft, type WorkspaceKind } from "@/lib/types";

interface Pin { draft: PinDraft; kind: WorkspaceKind }
interface WsInfo { kind: WorkspaceKind; name: string; brand: boolean; connected: boolean | null }
interface Usage { ledger: string; budget_usd: number; spent_usd: number; recent: unknown[] }
interface Status { storage: "supabase" | "demo"; text: { source: string; provider: string }; image: { source: string; provider: string }; pinterest: { configured: boolean } }
type Filter = "all" | WorkspaceKind;

const DAYS = 14;
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  in_review: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  approved: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  scheduled: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
  published: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
};

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function lastDays(n: number, today: Date) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  });
}
/** Counts per day for the last `n` days, keyed by the given date field. */
function series(pins: Pin[], field: (d: PinDraft) => string | null | undefined, days: Date[]) {
  const idx = new Map(days.map((d, i) => [dayKey(d), i]));
  const out = new Array(days.length).fill(0) as number[];
  for (const p of pins) {
    const v = field(p.draft);
    if (!v) continue;
    const i = idx.get(dayKey(new Date(v)));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const I = {
  grid: "M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  check: "M4 12.5 9 17.5 20 6.5",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
};
function Svg({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

const card = "rounded-2xl border border-zinc-200 bg-white";

/** Home after sign-in. Every number comes from this app's own pins; nothing here is mock data. */
export function Dashboard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [hello, setHello] = useState("Welcome back");
  const [today, setToday] = useState<Date | null>(null);
  const [mode, setMode] = useState<"supabase" | "demo" | null>(null);
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [spaces, setSpaces] = useState<WsInfo[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [idea, setIdea] = useState("");
  const [target, setTarget] = useState<WorkspaceKind>("fashion");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = getStore();
      const now = new Date();
      const h = now.getHours();
      setToday(now);
      setHello(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
      setMode(store.mode);
      if (store.mode === "demo") setName(getDemoUser()?.name ?? "");
      else {
        const p: { full_name?: unknown } = await fetch("/api/auth/profile").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
        if (!cancelled && typeof p.full_name === "string") setName(p.full_name.split(" ")[0]);
      }
      fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then((u) => !cancelled && setUsage(u)).catch(() => {});
      fetch("/api/status").then((r) => (r.ok ? r.json() : null)).then((s) => !cancelled && setStatus(s)).catch(() => {});
      try {
        const all: Pin[] = [];
        const ws: WsInfo[] = [];
        for (const kind of WORKSPACE_KINDS) {
          const w = await store.getWorkspace(kind);
          const [drafts, brand] = await Promise.all([store.listDrafts(w.id), store.getBrand(w.id)]);
          let connected: boolean | null = null;
          if (store.mode === "supabase") {
            const s = await fetch(`/api/pinterest/status?workspace=${kind}`).then((r) => r.json()).catch(() => ({}));
            connected = s.connection?.status === "active";
          }
          for (const d of drafts) if (!d.archived_at) all.push({ draft: d, kind });
          ws.push({ kind, name: w.name, brand: Boolean(brand.brand_name?.trim() || brand.website_url?.trim()), connected });
        }
        all.sort((a, b) => b.draft.created_at.localeCompare(a.draft.created_at));
        if (cancelled) return;
        setPins(all);
        setSpaces(ws);
        const firstTen = all.slice(0, 5);
        const pairs = await Promise.all(firstTen.map(async (p) => [p.draft.id, await store.imageUrl(p.draft).catch(() => null)] as const));
        if (!cancelled) setUrls(Object.fromEntries(pairs));
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => (pins ?? []).filter((p) => filter === "all" || p.kind === filter), [pins, filter]);
  const days = useMemo(() => (today ? lastDays(DAYS, today) : []), [today]);
  const made = useMemo(() => series(view, (d) => d.created_at, days), [view, days]);
  const kpis = useMemo(() => {
    const now = view.length;
    const review = view.filter((p) => p.draft.status === "in_review");
    const sched = view.filter((p) => p.draft.status === "scheduled");
    const pub = view.filter((p) => p.draft.status === "published");
    return [
      { label: "Pins made", value: now, s: made, href: "drafts", icon: I.grid, tone: "text-rose-600", bg: "bg-rose-50" },
      { label: "In review", value: review.length, s: series(review, (d) => d.updated_at, days), href: "publish", icon: I.eye, tone: "text-amber-600", bg: "bg-amber-50" },
      { label: "Scheduled", value: sched.length, s: series(sched, (d) => d.scheduled_for, days), href: "calendar", icon: I.cal, tone: "text-violet-600", bg: "bg-violet-50" },
      { label: "Published", value: pub.length, s: series(pub, (d) => d.published_at, days), href: "analytics", icon: I.check, tone: "text-emerald-600", bg: "bg-emerald-50" },
    ];
  }, [view, made, days]);
  const upcoming = useMemo(
    () => view.filter((p) => p.draft.status === "scheduled" && p.draft.scheduled_for).sort((a, b) => a.draft.scheduled_for!.localeCompare(b.draft.scheduled_for!)).slice(0, 5),
    [view],
  );
  const review = useMemo(() => view.filter((p) => p.draft.status === "in_review").slice(0, 4), [view]);
  const recent = view.slice(0, 5);
  const ws = filter === "all" ? target : filter;

  function create(e: React.FormEvent) {
    e.preventDefault();
    const q = idea.trim();
    router.push(q ? `/w/${target}?idea=${encodeURIComponent(q)}` : `/w/${target}`);
  }

  const budget = usage?.budget_usd ?? 0;
  const spent = usage?.spent_usd ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const dateLabel = today?.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) ?? "";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500">{dateLabel}</p>
          <h1 className="mt-0.5 text-2xl font-semibold sm:text-[1.9rem]">
            {hello}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Here is how your pins are doing.
            {mode === "demo" && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Demo mode · this browser only</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-zinc-900/5" role="radiogroup" aria-label="Show workspace">
            {(["all", ...WORKSPACE_KINDS] as Filter[]).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${filter === f ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}
              >
                {f === "all" ? "All" : WORKSPACE_LABELS[f]}
              </button>
            ))}
          </div>
          <Link href={`/w/${ws}`} className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3.5 py-2 text-sm font-semibold text-white">
            <Svg d={I.plus} /> New pins
          </Link>
        </div>
      </header>

      {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Could not load your pins: {err}</p>}

      {/* KPI row */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {kpis.map((k) => {
          const week = sum(k.s.slice(-7));
          return (
            <Link key={k.label} href={`/w/${ws}/${k.href}`} className={`${card} group flex flex-col p-4 sm:p-5`}>
              <div className="flex items-center gap-2.5">
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${k.bg} ${k.tone}`}>
                  <Svg d={k.icon} />
                </span>
                <p className="text-sm font-medium text-zinc-600">{k.label}</p>
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <p className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-900 sm:text-4xl">{pins ? k.value.toLocaleString() : "–"}</p>
                <Sparkline values={k.s} className={k.tone} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {pins ? (
                  <>
                    <span className="font-medium text-zinc-800">{week > 0 ? `+${week}` : "0"}</span> in the last 7 days
                  </>
                ) : (
                  "Loading…"
                )}
              </p>
            </Link>
          );
        })}
      </section>

      {/* Chart + quick create */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-zinc-900">Pins made per day</h2>
              <p className="text-xs text-zinc-500">Last {DAYS} days · {filter === "all" ? "all workspaces" : WORKSPACE_LABELS[filter]}</p>
            </div>
            <p className="text-right">
              <span className="block text-2xl font-semibold tabular-nums">{sum(made)}</span>
              <span className="text-xs text-zinc-500">total</span>
            </p>
          </div>
          <BarChart values={made} days={days} />
        </section>

        <section className={`${card} relative flex flex-col overflow-hidden p-5`}>
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-rose-500/10 blur-2xl" />
          <div className="relative flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-md shadow-rose-900/20">
              <Svg d={I.spark} />
            </span>
            <h2 className="font-semibold text-zinc-900">Quick create</h2>
          </div>
          <p className="relative mt-2 text-sm text-zinc-500">Type a keyword. You get finished pins with title, tags and a designed image.</p>
          <form onSubmit={create} className="relative mt-4 flex flex-1 flex-col gap-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1" role="radiogroup" aria-label="Workspace for new pins">
              {WORKSPACE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={target === k}
                  onClick={() => setTarget(k)}
                  className={`rounded-lg py-1.5 text-sm font-medium ${target === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"}`}
                >
                  {WORKSPACE_LABELS[k]}
                </button>
              ))}
            </div>
            <input
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={target === "fashion" ? "e.g. winter layering outfits" : "e.g. budget meal prep ideas"}
              aria-label="Pin idea"
              className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
            />
            <button className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white">
              Create pins <Svg d={I.arrow} />
            </button>
          </form>
        </section>
      </div>

      {/* Recent pins + upcoming */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900">Recent pins</h2>
            <Link href={`/w/${ws}/drafts`} className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900">
              View all <Svg d={I.arrow} className="h-3.5 w-3.5" />
            </Link>
          </div>
          {!pins && !err && <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-zinc-100" />)}</div>}
          {pins && recent.length === 0 && (
            <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-zinc-200 px-6 py-10 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <Svg d={I.grid} className="h-5 w-5" />
              </span>
              <p className="mt-3 font-medium text-zinc-900">No pins yet</p>
              <p className="mt-1 max-w-xs text-sm text-zinc-500">Use Quick create to make your first set. They show up here.</p>
            </div>
          )}
          {recent.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {recent.map(({ draft, kind }, i) => (
                <li key={draft.id} className={i >= 4 ? "hidden sm:block" : ""}>
                  <Link href={`/w/${kind}/drafts`} className="group block">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-900/5">
                      {urls[draft.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[draft.id]!} alt={draft.alt_text || draft.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-400">{draft.image_status === "pending" ? "Making image…" : "No image"}</div>
                      )}
                      <span className={`absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[draft.status]}`}>{STATUS_LABELS[draft.status]}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-zinc-800">{draft.title || draft.idea}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {WORKSPACE_LABELS[kind]}
                      {draft.source === "demo" && " · Demo text"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} flex flex-col p-5`}>
          <h2 className="font-semibold text-zinc-900">{upcoming.length > 0 ? "Coming up" : "Needs your review"}</h2>
          <p className="text-xs text-zinc-500">{upcoming.length > 0 ? "Next scheduled pins" : "Approve these before they can go out"}</p>
          <ul className="mt-3 flex flex-1 flex-col divide-y divide-zinc-100">
            {(upcoming.length > 0 ? upcoming : review).map(({ draft, kind }) => {
              const when = draft.scheduled_for ? new Date(draft.scheduled_for) : null;
              return (
                <li key={draft.id}>
                  <Link href={`/w/${kind}/${when ? "calendar" : "publish"}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-center text-[10px] font-semibold leading-tight ${when ? "bg-violet-50 text-violet-700" : "bg-amber-50 text-amber-700"}`}>
                      {when ? (
                        <>
                          {when.toLocaleDateString(undefined, { month: "short" })}
                          <br />
                          <span className="text-sm">{when.getDate()}</span>
                        </>
                      ) : (
                        <Svg d={I.eye} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-800">{draft.title || draft.idea}</span>
                      <span className="text-xs text-zinc-500">
                        {WORKSPACE_LABELS[kind]}
                        {when ? ` · ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {pins && upcoming.length === 0 && review.length === 0 && (
              <li className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Svg d={I.check} />
                </span>
                <p className="mt-2 text-sm font-medium text-zinc-800">All clear</p>
                <p className="text-xs text-zinc-500">Nothing waiting and nothing scheduled.</p>
              </li>
            )}
          </ul>
          <Link href={`/w/${ws}/${upcoming.length > 0 ? "calendar" : "publish"}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900">
            {upcoming.length > 0 ? "Open calendar" : "Open review"} <Svg d={I.arrow} className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>

      {/* Workspaces + system */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {spaces.map((w) => {
            const mine = (pins ?? []).filter((p) => p.kind === w.kind);
            const c = (s: string) => mine.filter((p) => p.draft.status === s).length;
            return (
              <div key={w.kind} className={`${card} flex flex-col gap-4 p-5`}>
                <div className="flex items-center gap-3">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white ${w.kind === "fashion" ? "from-rose-500 to-red-700" : "from-violet-500 to-indigo-700"}`}>{w.name.charAt(0)}</span>
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-tight text-zinc-900">{w.name}</h2>
                    <p className="text-xs text-zinc-500">{mine.length} pins</p>
                  </div>
                  <Link href={`/w/${w.kind}`} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50">Open</Link>
                </div>
                <dl className="grid grid-cols-3 divide-x divide-zinc-100 rounded-xl bg-zinc-50 py-2.5 text-center">
                  {([["Review", c("in_review")], ["Scheduled", c("scheduled")], ["Published", c("published")]] as const).map(([l, v]) => (
                    <div key={l}>
                      <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                      <dt className="text-[11px] text-zinc-500">{l}</dt>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <Check ok={w.brand} label="Brand set up" href={`/w/${w.kind}/settings`} />
                  <Check ok={w.connected === true} label="Pinterest connected" href={`/w/${w.kind}/pinterest`} />
                </div>
                {(() => {
                  const next = !w.brand
                    ? { href: `/w/${w.kind}/settings`, label: "Next: set up your brand" }
                    : w.connected !== true
                      ? { href: `/w/${w.kind}/pinterest`, label: "Next: connect Pinterest" }
                      : { href: `/w/${w.kind}`, label: "Make new pins" };
                  return (
                    <Link href={next.href} className="mt-auto inline-flex items-center justify-between rounded-xl bg-zinc-50 px-3.5 py-2.5 text-sm font-medium text-zinc-800 ring-1 ring-zinc-900/5 hover:bg-zinc-100">
                      {next.label} <Svg d={I.arrow} className="h-3.5 w-3.5" />
                    </Link>
                  );
                })()}
              </div>
            );
          })}
        </section>

        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900">AI budget</h2>
            <Link href={`/w/${ws}/usage`} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">Details</Link>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            ${spent.toFixed(2)}
            <span className="ml-1 text-sm font-normal text-zinc-500">/ ${budget.toFixed(2)} this month</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-rose-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
            <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-600" : pct >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">{usage ? `${pct}% used${usage.ledger !== "supabase" ? " · tracked in this browser" : ""}` : "Loading…"}</p>
          <div className="my-3.5 h-px bg-zinc-100" />
          <h3 className="text-sm font-semibold text-zinc-900">Connections</h3>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="Storage" ok={status?.storage === "supabase"} on="Cloud" off="Browser" loading={!status} />
            <Row label="Writing" ok={status?.text.source === "ai"} on="Live" off="Demo" loading={!status} title={status?.text.provider} />
            <Row label="Images" ok={status?.image.source === "ai"} on="Live" off={status?.image.source === "error" ? "Needs setup" : "Demo"} loading={!status} title={status?.image.provider} />
            <Row label="Pinterest" ok={status?.pinterest.configured === true} on="Ready" off="Not set" loading={!status} />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Check({ ok, label, href }: { ok: boolean; label: string; href: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-zinc-500 hover:text-zinc-800"}`}>
      <span className={`grid h-4 w-4 place-items-center rounded-full ${ok ? "bg-emerald-100" : "ring-1 ring-zinc-300"}`}>{ok && <Svg d={I.check} className="h-2.5 w-2.5" />}</span>
      {label}
    </Link>
  );
}

function Row({ label, ok, on, off, loading, title }: { label: string; ok: boolean | undefined; on: string; off: string; loading: boolean; title?: string }) {
  return (
    <li className="flex items-center gap-2" title={title}>
      <span className={`h-2 w-2 rounded-full ${loading ? "bg-zinc-300" : ok ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
      <span className="text-zinc-600">{label}</span>
      <span className={`ml-auto whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ${loading ? "text-zinc-400" : ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{loading ? "…" : ok ? on : off}</span>
    </li>
  );
}

/** 2px trend line, last point marked. Colour comes from the parent's text colour. */
function Sparkline({ values, className }: { values: number[]; className: string }) {
  const w = 84, h = 30, pad = 3;
  if (values.length < 2) return <span className="h-[30px] w-[84px]" />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [pad + (i * (w - 2 * pad)) / (values.length - 1), h - pad - (v / max) * (h - 2 * pad)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`shrink-0 ${className}`} aria-hidden>
      <path d={`${line}L${lx},${h}L${pad},${h}Z`} fill="currentColor" opacity={0.1} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3.5} fill="currentColor" stroke="white" strokeWidth={2} />
    </svg>
  );
}

/** Single-series column chart with a hover tooltip and a hidden table for screen readers. */
function BarChart({ values, days }: { values: number[]; days: Date[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, 0);
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const ticks = [0, top / 2, top];
  const H = 180;
  const empty = max === 0;
  return (
    <div className="mt-5">
      <div className="relative flex gap-3">
        <div className="relative w-6 shrink-0 text-right text-[11px] tabular-nums text-zinc-400" style={{ height: H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>{t}</span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-zinc-100" style={{ top: H - (t / top) * H }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {values.map((v, i) => (
              <div key={i} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
                {hover === i && <div className="absolute inset-y-0 inset-x-0.5 rounded-md bg-zinc-900/[0.03]" aria-hidden />}
                <div
                  className={`relative w-full max-w-[24px] rounded-t-[4px] transition-colors ${hover === i ? "bg-rose-600" : "bg-rose-500"}`}
                  style={{ height: v === 0 ? 0 : Math.max(3, (v / top) * H) }}
                />
                {hover === i && (
                  <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ bottom: Math.min(H - 8, (v / top) * H + 8) }}>
                    <span className="font-semibold tabular-nums">{v}</span> pin{v === 1 ? "" : "s"}
                    <span className="block text-[10px] text-white/60">{days[i]?.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {empty && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="rounded-lg bg-white/90 px-3 py-1.5 text-sm text-zinc-500 ring-1 ring-zinc-100">No pins made in the last {values.length} days</p>
            </div>
          )}
        </div>
      </div>
      <div className="ml-9 mt-2 flex text-[11px] text-zinc-400" aria-hidden>
        {days.map((d, i) => (
          <span key={i} className="flex-1 text-center">{i % 2 === (days.length - 1) % 2 ? d.getDate() : ""}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Pins made per day</caption>
        <tbody>
          {days.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.toDateString()}</th>
              <td>{values[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
