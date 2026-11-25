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

const card = "rounded-3xl border border-zinc-200 bg-white/90 backdrop-blur";

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
        const firstTen = all.slice(0, 6);
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
      { label: "Pins made", value: now, s: made, href: "drafts", icon: I.grid, tone: "text-rose-600", grad: "from-rose-500 to-red-700" },
      { label: "In review", value: review.length, s: series(review, (d) => d.updated_at, days), href: "publish", icon: I.eye, tone: "text-amber-500", grad: "from-amber-400 to-orange-600" },
      { label: "Scheduled", value: sched.length, s: series(sched, (d) => d.scheduled_for, days), href: "calendar", icon: I.cal, tone: "text-violet-600", grad: "from-violet-500 to-indigo-700" },
      { label: "Published", value: pub.length, s: series(pub, (d) => d.published_at, days), href: "analytics", icon: I.check, tone: "text-emerald-600", grad: "from-emerald-400 to-teal-700" },
    ];
  }, [view, made, days]);
  const upcoming = useMemo(
    () => view.filter((p) => p.draft.status === "scheduled" && p.draft.scheduled_for).sort((a, b) => a.draft.scheduled_for!.localeCompare(b.draft.scheduled_for!)).slice(0, 5),
    [view],
  );
  const review = useMemo(() => view.filter((p) => p.draft.status === "in_review").slice(0, 4), [view]);
  const recent = view.slice(0, 6);
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
      {/* Hero */}
      <section className="pas-grain relative isolate overflow-hidden rounded-[2rem] bg-[#1a0a0d] text-white shadow-[0_40px_80px_-40px_rgba(76,5,25,0.8)]">
        <div aria-hidden className="absolute inset-0 -z-10" style={{ background: "radial-gradient(700px 420px at 15% 0%, rgba(225,29,72,0.55), transparent 65%), radial-gradient(600px 400px at 100% 100%, rgba(245,158,11,0.28), transparent 60%), radial-gradient(500px 300px at 70% 10%, rgba(190,18,60,0.45), transparent 60%)" }} />
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.15fr_1fr] lg:gap-4 lg:p-12">
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15 backdrop-blur">{dateLabel}</span>
              {mode === "demo" && <span className="rounded-full bg-amber-300/15 px-3 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-200/25">Demo mode · this browser only</span>}
            </div>
            <h1 className="mt-5 font-[family-name:var(--font-display)] text-[2.6rem] leading-[1.02] !text-white sm:text-6xl">
              {hello}
              {name ? "," : ""}
              <br />
              <span className="pas-shine font-[family-name:var(--font-editorial)] italic">{name || "creator"}.</span>
            </h1>
            <p className="mt-4 max-w-md text-base text-white/65">
              {pins && pins.length > 0 ? <>You have <strong className="text-white">{pins.length} pins</strong> in your studio. What are we making next?</> : "Type one idea. Get scroll-stopping pins with titles, tags and designed images."}
            </p>
            <form onSubmit={create} className="mt-7 rounded-2xl bg-white/[0.08] p-2 ring-1 ring-white/15 backdrop-blur-xl">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex shrink-0 gap-1 rounded-xl bg-black/25 p-1" role="radiogroup" aria-label="Workspace for new pins">
                  {WORKSPACE_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={target === k}
                      onClick={() => setTarget(k)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${target === k ? "bg-white text-[#2a1416] shadow-lg" : "text-white/60 hover:text-white"}`}
                    >
                      {WORKSPACE_LABELS[k]}
                    </button>
                  ))}
                </div>
                <input
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder={target === "fashion" ? "winter layering outfits…" : "budget meal prep ideas…"}
                  aria-label="Pin idea"
                  className="min-w-0 flex-1 rounded-xl border-0 bg-transparent px-3 py-2.5 text-base text-white placeholder:text-white/40 focus:!border-0 focus:!shadow-none focus:outline-none"
                />
                <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-amber-200 via-amber-300 to-orange-400 px-5 py-2.5 text-sm font-bold text-[#2a1416] shadow-[0_10px_30px_-8px_rgba(251,191,36,0.6)] transition hover:scale-[1.02]">
                  Create pins <Svg d={I.arrow} />
                </button>
              </div>
            </form>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {(target === "fashion" ? ["Holiday party outfits", "Capsule wardrobe", "Cozy knitwear"] : ["High protein breakfast", "Meal prep for week", "Healthy snacks"]).map((t) => (
                <button key={t} type="button" onClick={() => setIdea(t)} className="rounded-full bg-white/[0.06] px-3 py-1 text-white/70 ring-1 ring-white/10 transition hover:bg-white/15 hover:text-white">
                  {t}
                </button>
              ))}
            </div>
          </div>
          <Mosaic items={recent.slice(0, 5).map((p) => ({ id: p.draft.id, url: urls[p.draft.id] ?? null, title: p.draft.title || p.draft.idea }))} />
        </div>
      </section>

      {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Could not load your pins: {err}</p>}

      {/* Overview header */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700/70">Overview</p>
          <h2 className="font-[family-name:var(--font-display)] text-3xl text-[#1c1214]">Your pin performance</h2>
        </div>
        <div className="flex rounded-full bg-white/80 p-1 shadow-sm ring-1 ring-zinc-900/5 backdrop-blur" role="radiogroup" aria-label="Show workspace">
          {(["all", ...WORKSPACE_KINDS] as Filter[]).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${filter === f ? "bg-gradient-to-br from-rose-600 to-red-800 text-white shadow-md shadow-rose-900/20" : "text-zinc-600 hover:text-zinc-900"}`}
            >
              {f === "all" ? "All" : WORKSPACE_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {kpis.map((k) => {
          const week = sum(k.s.slice(-7));
          return (
            <Link key={k.label} href={`/w/${ws}/${k.href}`} className={`${card} group relative flex flex-col overflow-hidden p-4 sm:p-5`}>
              <div aria-hidden className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${k.grad} opacity-15 blur-2xl transition-opacity duration-500 group-hover:opacity-35`} />
              <div className="relative flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-600">{k.label}</p>
                <span className={`grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br ${k.grad} text-white shadow-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110`}>
                  <Svg d={k.icon} className="h-5 w-5" />
                </span>
              </div>
              <p className="relative mt-3 font-[family-name:var(--font-display)] text-5xl leading-none tabular-nums text-[#1c1214]">{pins ? k.value.toLocaleString() : "–"}</p>
              <div className="relative mt-3 flex items-end justify-between gap-2">
                <p className="whitespace-nowrap text-xs text-zinc-500">
                  <span className={`mr-1 rounded-full px-1.5 py-0.5 font-semibold ${week > 0 ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{week > 0 ? `+${week}` : "0"}</span>
                  7 days
                </p>
                <Sparkline values={k.s} className={`hidden sm:block ${k.tone}`} />
              </div>
            </Link>
          );
        })}
      </section>

      {/* Chart + review */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${card} p-5 sm:p-6 lg:col-span-2`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-zinc-900">Pins made per day</h2>
              <p className="text-xs text-zinc-500">Last {DAYS} days · {filter === "all" ? "all workspaces" : WORKSPACE_LABELS[filter]}</p>
            </div>
            <p className="text-right">
              <span className="block font-[family-name:var(--font-display)] text-3xl leading-none tabular-nums">{sum(made)}</span>
              <span className="text-xs text-zinc-500">total</span>
            </p>
          </div>
          <BarChart values={made} days={days} />
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

      {/* Recent pins */}
      <div className="grid gap-4">
        <section className={`${card} p-5 sm:p-6`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900">Recent pins</h2>
            <Link href={`/w/${ws}/drafts`} className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900">
              View all <Svg d={I.arrow} className="h-3.5 w-3.5" />
            </Link>
          </div>
          {!pins && !err && <div className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-zinc-100" />)}</div>}
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
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
              {recent.map(({ draft, kind }, i) => (
                <li key={draft.id} className={i >= 4 ? "hidden sm:block" : ""}>
                  <Link href={`/w/${kind}/drafts`} className="group block">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-zinc-100 shadow-sm ring-1 ring-zinc-900/5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_-16px_rgba(76,5,25,0.45)]">
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
  const H = 200;
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
                  className={`pas-grow relative w-full max-w-[24px] rounded-t-[4px] bg-gradient-to-t transition-all ${hover === i ? "from-rose-700 to-amber-400" : "from-red-800 to-rose-500"}`}
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

const TILE = [
  "from-rose-400 via-rose-600 to-red-900",
  "from-amber-200 via-orange-400 to-rose-600",
  "from-fuchsia-400 via-rose-500 to-red-800",
  "from-orange-200 via-amber-400 to-amber-700",
  "from-red-500 via-rose-700 to-[#3b0a14]",
];
const SPOTS = [
  { c: "left-[4%] top-[14%] w-[30%]", r: "-8deg", d: "0s" },
  { c: "left-[36%] top-[0%] w-[30%] z-20", r: "3deg", d: "-2s" },
  { c: "left-[68%] top-[12%] w-[29%]", r: "9deg", d: "-4s" },
  { c: "left-[18%] top-[52%] w-[27%] hidden sm:block", r: "6deg", d: "-1s" },
  { c: "left-[50%] top-[50%] w-[27%] hidden sm:block", r: "-5deg", d: "-3s" },
];

/** Floating collage of the user's latest pins; illustrated pin cards fill the gaps. */
function Mosaic({ items }: { items: { id: string; url: string | null; title: string }[] }) {
  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="absolute inset-[10%] rounded-full bg-rose-500/30 blur-3xl" />
      {SPOTS.map((sp, i) => {
        const it = items[i];
        return (
          <div key={i} className={`pas-float absolute ${sp.c}`} style={{ ["--r" as string]: sp.r, animationDelay: sp.d, transform: `rotate(${sp.r})` }}>
            <div className="overflow-hidden rounded-2xl bg-white/10 p-1 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/20 backdrop-blur">
              <div className={`relative aspect-[2/3] overflow-hidden rounded-xl bg-gradient-to-br ${TILE[i]}`}>
                {it?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col justify-end p-2.5">
                    <div className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-[10px] font-bold text-red-700">P</div>
                    <div className="h-1.5 w-3/4 rounded-full bg-white/80" />
                    <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-white/50" />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div className="pas-float absolute bottom-[4%] right-[2%] z-30 flex items-center gap-2 rounded-2xl bg-white/95 px-3 py-2 text-[#2a1416] shadow-2xl" style={{ animationDelay: "-5s" }}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-red-700 text-white">
          <Svg d={I.spark} className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs leading-tight">
          <strong className="block">AI designed</strong>
          <span className="text-zinc-500">2:3 Pinterest size</span>
        </span>
      </div>
    </div>
  );
}
