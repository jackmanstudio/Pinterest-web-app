"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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

const card = "rounded-xl border border-[#1f1e22] bg-[#0f0f12]";

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
  const cmd = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K jumps to the create bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        cmd.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        const firstTen = all.slice(0, 8);
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
  const recent = view.slice(0, 8);
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

  const PILL: Record<string, string> = {
    draft: "border-[#333238] text-[#a6a2aa]",
    in_review: "border-amber-400/30 text-amber-300",
    approved: "border-sky-400/30 text-sky-300",
    scheduled: "border-violet-400/30 text-violet-300",
    published: "border-emerald-400/30 text-emerald-300",
  };
  const ago = (iso: string) => {
    if (!today) return "";
    const m = Math.max(0, Math.round((today.getTime() - new Date(iso).getTime()) / 60000));
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };

  return (
    <div className="mp-in flex flex-col gap-5">
      {/* Greeting + command bar */}
      <section className="flex flex-col gap-4 pt-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] text-[#8b8890]">{dateLabel}</p>
            <h1 className="mt-1 text-[1.9rem] font-semibold leading-tight sm:text-4xl">
              {hello}
              {name ? `, ${name}` : ""}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {mode === "demo" && <span className="rounded-full border border-amber-400/30 px-2.5 py-1 text-xs font-medium text-amber-300">Demo · this browser only</span>}
            <div className="flex rounded-lg border border-[#232227] bg-[#0f0f12] p-0.5" role="radiogroup" aria-label="Show workspace">
              {(["all", ...WORKSPACE_KINDS] as Filter[]).map((f) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${filter === f ? "bg-[#1f1f24] text-white" : "text-[#8b8890] hover:text-white"}`}
                >
                  {f === "all" ? "All" : WORKSPACE_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={create} className="group flex flex-col gap-2 rounded-xl border border-[#2a292e] bg-[#0f0f12] p-1.5 shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_20px_50px_-20px_rgba(230,0,35,0.35)] transition-colors focus-within:border-[#e60023]/60 sm:flex-row sm:items-center">
          <div className="flex shrink-0 gap-0.5 rounded-lg bg-[#17171b] p-0.5" role="radiogroup" aria-label="Workspace for new pins">
            {WORKSPACE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={target === k}
                onClick={() => setTarget(k)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-semibold ${target === k ? "bg-[#26262c] text-white" : "text-[#8b8890] hover:text-white"}`}
              >
                {WORKSPACE_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
            <Svg d={I.spark} className="h-4 w-4 shrink-0 text-[#ff4d6a]" />
            <input
              ref={cmd}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Type a keyword or product idea…"
              aria-label="Pin idea"
              className="min-w-0 flex-1 !border-0 !bg-transparent py-2 text-[15px] !shadow-none outline-none"
            />
            <kbd className="hidden rounded border border-[#2a292e] px-1.5 py-0.5 font-sans text-[11px] text-[#6c6970] sm:inline">⌘K</kbd>
          </div>
          <button className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#f2f0f3] px-4 py-2 text-[13px] font-semibold text-[#0b0b0d] transition hover:bg-white">
            Create pins <Svg d={I.arrow} className="h-3.5 w-3.5" />
          </button>
        </form>
      </section>

      {err && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">Could not load your pins: {err}</p>}

      {/* Stat boxes */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((k) => {
          const week = sum(k.s.slice(-7));
          return (
            <Link key={k.label} href={`/w/${ws}/${k.href}`} className={`${card} group flex flex-col p-4 transition-colors hover:border-[#34333a] hover:bg-[#121215]`}>
              <div className="flex items-center justify-between text-[13px] text-[#8b8890]">
                <span className="flex items-center gap-2">
                  <Svg d={k.icon} className="h-3.5 w-3.5" />
                  {k.label}
                </span>
                <Svg d={I.arrow} className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <p className="font-[family-name:var(--font-display)] text-[2rem] font-semibold leading-none tracking-tight tabular-nums text-white">{pins ? k.value.toLocaleString() : "–"}</p>
                <Sparkline values={k.s} className="hidden text-[#e60023] sm:block" />
              </div>
              <p className="mt-2 text-xs text-[#6c6970]">
                <span className={week > 0 ? "text-emerald-400" : "text-[#8b8890]"}>{week > 0 ? `+${week}` : "0"}</span> last 7 days
              </p>
            </Link>
          );
        })}
      </section>

      {/* Chart + side */}
      <div className="grid gap-3 lg:grid-cols-3">
        <section className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Pins made per day</h2>
              <p className="text-xs text-[#6c6970]">Last {DAYS} days · {filter === "all" ? "all workspaces" : WORKSPACE_LABELS[filter]}</p>
            </div>
            <p className="text-right">
              <span className="block font-[family-name:var(--font-display)] text-2xl font-semibold leading-none tabular-nums text-white">{sum(made)}</span>
              <span className="text-xs text-[#6c6970]">total</span>
            </p>
          </div>
          <BarChart values={made} days={days} />
        </section>

        <section className={`${card} flex flex-col p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">{upcoming.length > 0 ? "Coming up" : "Needs review"}</h2>
            <Link href={`/w/${ws}/${upcoming.length > 0 ? "calendar" : "publish"}`} className="text-xs text-[#8b8890] hover:text-white">Open</Link>
          </div>
          <ul className="mt-3 flex flex-1 flex-col">
            {(upcoming.length > 0 ? upcoming : review).map(({ draft, kind }) => {
              const when = draft.scheduled_for ? new Date(draft.scheduled_for) : null;
              return (
                <li key={draft.id} className="border-b border-[#1d1c20] last:border-0">
                  <Link href={`/w/${kind}/${when ? "calendar" : "publish"}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                    <span className="w-12 shrink-0 text-xs tabular-nums text-[#8b8890]">{when ? when.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "Review"}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#e9e7ea]">{draft.title || draft.idea}</span>
                  </Link>
                </li>
              );
            })}
            {pins && upcoming.length === 0 && review.length === 0 && (
              <li className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-emerald-400/30 text-emerald-400">
                  <Svg d={I.check} />
                </span>
                <p className="mt-2 text-[13px] font-medium text-white">All clear</p>
                <p className="text-xs text-[#6c6970]">Nothing waiting, nothing scheduled.</p>
              </li>
            )}
          </ul>
          <div className="mt-3 border-t border-[#1d1c20] pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-[#8b8890]">AI budget this month</span>
              <span className="text-[13px] tabular-nums text-white">
                ${spent.toFixed(2)} <span className="text-[#6c6970]">/ ${budget.toFixed(2)}</span>
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1f1e22]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
              <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-[#e60023]"}`} style={{ width: `${Math.max(pct, 1)}%` }} />
            </div>
          </div>
        </section>
      </div>

      {/* Recent pins list + workspaces */}
      <div className="grid gap-3 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h2 className="text-[15px] font-semibold">Recent pins</h2>
            <Link href={`/w/${ws}/drafts`} className="inline-flex items-center gap-1 text-xs text-[#8b8890] hover:text-white">
              Pin library <Svg d={I.arrow} className="h-3 w-3" />
            </Link>
          </div>
          {!pins && !err && <div className="space-y-2 px-5 pb-5">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-[#141417]" />)}</div>}
          {pins && recent.length === 0 && (
            <div className="flex flex-col items-center px-6 pb-10 pt-6 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-[#2a292e] text-[#ff4d6a]">
                <Svg d={I.grid} className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[13px] font-medium text-white">No pins yet</p>
              <p className="mt-1 max-w-xs text-xs text-[#6c6970]">Press ⌘K and type an idea to make your first set.</p>
            </div>
          )}
          {recent.length > 0 && (
            <ul className="pb-2">
              {recent.map(({ draft, kind }) => (
                <li key={draft.id}>
                  <Link href={`/w/${kind}/drafts`} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#1d1c20] px-5 py-2.5 transition-colors hover:bg-[#121215] sm:grid-cols-[2.25rem_minmax(0,1fr)_auto_4.5rem]">
                    <span className="block h-12 w-9 overflow-hidden rounded-md bg-[#1a1a1f] ring-1 ring-white/5">
                      {urls[draft.id] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[draft.id]!} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#f3f1f4]">{draft.title || draft.idea}</span>
                      <span className="block truncate text-xs text-[#6c6970]">
                        {WORKSPACE_LABELS[kind]}
                        {draft.source === "demo" ? " · Demo text" : ""}
                      </span>
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL[draft.status]}`}>{STATUS_LABELS[draft.status]}</span>
                    <span className="hidden text-right text-xs tabular-nums text-[#6c6970] sm:block">{ago(draft.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-3">
          {spaces.map((w) => {
            const mine = (pins ?? []).filter((p) => p.kind === w.kind);
            const c = (st: string) => mine.filter((p) => p.draft.status === st).length;
            const next = !w.brand
              ? { href: `/w/${w.kind}/settings`, label: "Set up brand" }
              : w.connected !== true
                ? { href: `/w/${w.kind}/pinterest`, label: "Connect Pinterest" }
                : { href: `/w/${w.kind}`, label: "Make pins" };
            return (
              <section key={w.kind} className={`${card} p-4`}>
                <div className="flex items-center gap-3">
                  <span className={`grid h-8 w-8 place-items-center rounded-md text-[13px] font-bold text-white ${w.kind === "fashion" ? "bg-[#e60023]" : "bg-[#5b4bdb]"}`}>{w.name.charAt(0)}</span>
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold leading-tight">{w.name}</h2>
                    <p className="text-xs text-[#6c6970]">{mine.length} pins</p>
                  </div>
                  <Link href={`/w/${w.kind}`} className="ml-auto rounded-md border border-[#2a292e] px-2.5 py-1 text-xs font-medium text-[#cfcbd2] hover:border-[#3a393f] hover:text-white">Open</Link>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {([["Review", c("in_review")], ["Scheduled", c("scheduled")], ["Live", c("published")]] as const).map(([l, v]) => (
                    <div key={l} className="rounded-md border border-[#1d1c20] py-1.5">
                      <dd className="text-[15px] font-semibold tabular-nums text-white">{v}</dd>
                      <dt className="text-[11px] text-[#6c6970]">{l}</dt>
                    </div>
                  ))}
                </dl>
                <Link href={next.href} className="mt-3 flex items-center justify-between text-xs text-[#a6a2aa] hover:text-white">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${w.brand && w.connected ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
                    Next: {next.label}
                  </span>
                  <Svg d={I.arrow} className="h-3 w-3" />
                </Link>
              </section>
            );
          })}
          <section className={`${card} p-4`}>
            <h2 className="text-[14px] font-semibold">Connections</h2>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              <Row label="Storage" ok={status?.storage === "supabase"} on="Cloud" off="Browser" loading={!status} />
              <Row label="Writing" ok={status?.text.source === "ai"} on="Live" off="Demo" loading={!status} title={status?.text.provider} />
              <Row label="Images" ok={status?.image.source === "ai"} on="Live" off={status?.image.source === "error" ? "Setup" : "Demo"} loading={!status} title={status?.image.provider} />
              <Row label="Pinterest" ok={status?.pinterest.configured === true} on="Ready" off="Not set" loading={!status} />
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, ok, on, off, loading, title }: { label: string; ok: boolean | undefined; on: string; off: string; loading: boolean; title?: string }) {
  return (
    <li className="flex items-center gap-2" title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${loading ? "bg-zinc-600" : ok ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
      <span className="text-[#8b8890]">{label}</span>
      <span className={`ml-auto whitespace-nowrap text-xs font-medium ${loading ? "text-[#6c6970]" : ok ? "text-emerald-300" : "text-amber-300"}`}>{loading ? "…" : ok ? on : off}</span>
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
      <circle cx={lx} cy={ly} r={3.5} fill="currentColor" stroke="#0f0f12" strokeWidth={2} />
    </svg>
  );
}

/** Single-series column chart with a hover tooltip and a hidden table for screen readers. */
function BarChart({ values, days }: { values: number[]; days: Date[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, 0);
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const ticks = [0, top / 2, top];
  const H = 190;
  const empty = max === 0;
  return (
    <div className="mt-5">
      <div className="relative flex gap-3">
        <div className="relative w-6 shrink-0 text-right text-[11px] tabular-nums text-[#5d5a62]" style={{ height: H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>{t}</span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-[#1d1c20]" style={{ top: H - (t / top) * H }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {values.map((v, i) => (
              <div key={i} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
                {hover === i && <div className="absolute inset-y-0 inset-x-0.5 rounded-md bg-white/[0.03]" aria-hidden />}
                <div
                  className={`relative w-full max-w-[20px] rounded-t-[4px] transition-colors ${hover === i ? "bg-[#ff4d6a]" : "bg-[#e60023]"}`}
                  style={{ height: v === 0 ? 0 : Math.max(3, (v / top) * H) }}
                />
                {hover === i && (
                  <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-[#2a292e] bg-[#17171b] px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ bottom: Math.min(H - 8, (v / top) * H + 8) }}>
                    <span className="font-semibold tabular-nums">{v}</span> pin{v === 1 ? "" : "s"}
                    <span className="block text-[10px] text-white/60">{days[i]?.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {empty && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="rounded-lg border border-[#232227] bg-[#0f0f12] px-3 py-1.5 text-[13px] text-[#8b8890]">No pins made in the last {values.length} days</p>
            </div>
          )}
        </div>
      </div>
      <div className="ml-9 mt-2 flex text-[11px] text-[#5d5a62]" aria-hidden>
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

