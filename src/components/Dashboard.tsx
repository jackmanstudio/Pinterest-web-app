"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStore } from "@/lib/store";
import { getDemoUser } from "@/lib/auth/demo";
import { WORKSPACE_KINDS, WORKSPACE_LABELS, type PinDraft, type WorkspaceKind } from "@/lib/types";

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
        const firstTen = all.slice(0, 12);
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
  const strip = view.slice(0, 5);
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

  const count = (st: string) => view.filter((p) => p.draft.status === st).length;
  const week = sum(made.slice(-7));
  const prevWeek = sum(made.slice(0, 7));
  const STRIP_BG = ["from-orange-300 to-rose-500", "from-violet-300 to-fuchsia-600", "from-teal-200 to-emerald-600", "from-amber-200 to-orange-500", "from-sky-200 to-indigo-500"];
  const n = (v: number) => (pins ? v.toLocaleString() : "–");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#77746e]">
            {hello}
            {name ? `, ${name}` : ""} · {dateLabel}
          </p>
          <h1 className="text-4xl leading-none sm:text-5xl">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          {mode === "demo" && <span className="whitespace-nowrap rounded-lg bg-[#ffd23f] px-2.5 py-1.5 text-xs font-bold text-[#141414]" title="Saved in this browser only">Demo mode</span>}
          <div className="flex gap-1 rounded-xl bg-[#141414] p-1" role="radiogroup" aria-label="Show workspace">
            {(["all", ...WORKSPACE_KINDS] as Filter[]).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors ${filter === f ? "bg-white text-[#141414]" : "text-[#9a978f] hover:text-white"}`}
              >
                {f === "all" ? "All" : WORKSPACE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">Could not load your pins: {err}</p>}

      <div className="bb-grid grid grid-cols-2 gap-3 sm:gap-4 lg:auto-rows-[minmax(150px,auto)] lg:grid-cols-4">
        {/* Create: big red tile */}
        <section className="bb-tile relative col-span-2 flex flex-col justify-between overflow-hidden rounded-3xl bg-[#e60023] p-6 text-white lg:row-span-2 lg:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 right-10 h-48 w-48 rounded-full bg-black/10" />
          <div className="relative">
            <p className="text-sm font-semibold text-white/75">Create</p>
            <h2 className="mt-1 max-w-sm font-[family-name:var(--font-display)] text-3xl font-extrabold leading-[1.05] !text-white sm:text-4xl">Make new pins from one idea</h2>
          </div>
          <form onSubmit={create} className="relative mt-6 flex flex-col gap-2">
            <div className="flex gap-1 self-start rounded-xl bg-black/20 p-1" role="radiogroup" aria-label="Workspace for new pins">
              {WORKSPACE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={target === k}
                  onClick={() => setTarget(k)}
                  className={`rounded-lg px-3 py-1 text-[13px] font-bold ${target === k ? "bg-white text-[#e60023]" : "text-white/80 hover:text-white"}`}
                >
                  {WORKSPACE_LABELS[k]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-white p-1.5 pl-4">
              <input
                ref={cmd}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder={target === "fashion" ? "summer linen outfits" : "budget meal prep"}
                aria-label="Pin idea"
                className="min-w-0 flex-1 !border-0 !bg-transparent py-2 text-[15px] font-medium text-[#141414] !shadow-none outline-none placeholder:text-[#9a978f]"
              />
              <button className="shrink-0 rounded-xl bg-[#141414] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-black">Create →</button>
            </div>
          </form>
        </section>

        <Tile href={`/w/${ws}/analytics`} className="bg-[#141414] text-white" label="Live" value={n(count("published"))} note="on Pinterest" />
        <Tile href={`/w/${ws}/publish`} className="bg-[#ffd23f] text-[#141414]" label="Review" value={n(count("in_review"))} note="waiting for you" />
        <Tile href={`/w/${ws}/calendar`} className="bg-[#c9e4ff] text-[#141414]" label="Scheduled" value={n(count("scheduled"))} note="queued" />
        <Tile href={`/w/${ws}/drafts`} className="bg-white text-[#141414]" label="Pins made" value={n(view.length)} note={`${week} this week`} />

        {/* Recent pins strip */}
        <Link href={`/w/${ws}/drafts`} className="bb-tile col-span-2 flex flex-col gap-3 rounded-3xl bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Recent pins</p>
            <span className="text-xs font-semibold text-[#77746e]">Open library →</span>
          </div>
          <div className="grid flex-1 grid-cols-5 gap-2">
            {Array.from({ length: 5 }, (_, i) => {
              const p = strip[i];
              const url = p ? urls[p.draft.id] : null;
              return (
                <div key={i} className={`relative aspect-[2/3] overflow-hidden rounded-xl bg-gradient-to-br ${STRIP_BG[i]} ${p ? "" : "opacity-30"}`} title={p ? p.draft.title : undefined}>
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={p!.draft.alt_text || p!.draft.title} className="h-full w-full object-cover" />
                  )}
                </div>
              );
            })}
          </div>
          {pins && strip.length === 0 && <p className="text-xs text-[#77746e]">No pins yet. Use the red Create tile.</p>}
        </Link>

        {/* Week chart */}
        <section className="bb-tile col-span-2 flex flex-col justify-between rounded-3xl bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">Pins made, last 14 days</p>
              <p className="text-xs text-[#77746e]">{week >= prevWeek ? `${week - prevWeek >= 0 ? "+" : ""}${week - prevWeek} vs the week before` : `${week - prevWeek} vs the week before`}</p>
            </div>
            <p className="bb-num text-4xl">{n(sum(made))}</p>
          </div>
          <Bars values={made} days={days} />
        </section>

        {/* AI cost */}
        <Link href={`/w/${ws}/usage`} className="bb-tile flex flex-col justify-between rounded-3xl bg-white p-5">
          <p className="text-sm font-bold">AI cost</p>
          <div>
            <p className="bb-num text-4xl">${spent.toFixed(2)}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f3f1ec]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
              <div className={`h-full rounded-full ${pct >= 90 ? "bg-[#e60023]" : "bg-[#141414]"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-[#77746e]">of ${budget.toFixed(2)} this month</p>
          </div>
        </Link>

        {/* Connections */}
        <section className="bb-tile flex flex-col justify-between rounded-3xl bg-[#e6ddff] p-5">
          <p className="text-sm font-bold">Connections</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
            <Row label="Storage" ok={status?.storage === "supabase"} on="Cloud" off="Browser" loading={!status} />
            <Row label="Writing" ok={status?.text.source === "ai"} on="Live" off="Demo" loading={!status} title={status?.text.provider} />
            <Row label="Images" ok={status?.image.source === "ai"} on="Live" off={status?.image.source === "error" ? "Setup" : "Demo"} loading={!status} title={status?.image.provider} />
            <Row label="Pinterest" ok={status?.pinterest.configured === true} on="Ready" off="Not set" loading={!status} />
          </ul>
        </section>

        {/* Workspaces */}
        {spaces.map((w) => {
          const mine = (pins ?? []).filter((p) => p.kind === w.kind);
          const next = !w.brand ? { href: `/w/${w.kind}/settings`, label: "Set up brand" } : w.connected !== true ? { href: `/w/${w.kind}/pinterest`, label: "Connect Pinterest" } : { href: `/w/${w.kind}`, label: "Make pins" };
          return (
            <section key={w.kind} className={`bb-tile col-span-2 flex flex-col justify-between gap-4 rounded-3xl p-5 lg:col-span-1 ${w.kind === "fashion" ? "bg-[#ffd6de]" : "bg-[#c8f0d8]"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{w.name}</p>
                  <p className="bb-num mt-2 text-6xl">{n(mine.length)}</p>
                  <p className="mt-1 text-xs font-medium text-[#141414]/60">pins</p>
                </div>
                <Link href={`/w/${w.kind}`} className="rounded-xl bg-[#141414] px-3 py-1.5 text-sm font-bold text-white hover:bg-black">Open</Link>
              </div>
              <div className="flex flex-col gap-2 text-xs font-semibold">
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-lg bg-white/70 px-2 py-1">{mine.filter((p) => p.draft.status === "in_review").length} review</span>
                  <span className="rounded-lg bg-white/70 px-2 py-1">{mine.filter((p) => p.draft.status === "scheduled").length} scheduled</span>
                  <span className="rounded-lg bg-white/70 px-2 py-1">{mine.filter((p) => p.draft.status === "published").length} live</span>
                </div>
                <Link href={next.href} className="rounded-lg bg-[#141414]/10 px-2.5 py-1.5 hover:bg-[#141414]/20">Next: {next.label} →</Link>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ href, className, label, value, note }: { href: string; className: string; label: string; value: string; note: string }) {
  return (
    <Link href={href} className={`bb-tile flex min-h-[140px] flex-col justify-between rounded-3xl p-5 ${className}`}>
      <p className="text-sm font-bold opacity-80">{label}</p>
      <div>
        <p className="bb-num text-6xl">{value}</p>
        <p className="mt-1 text-xs font-medium opacity-60">{note}</p>
      </div>
    </Link>
  );
}

/** 14 thin columns; today in red. Values are in each bar's tooltip and the hidden table. */
function Bars({ values, days }: { values: number[]; days: Date[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-4">
      <div className="flex h-24 items-end gap-[3px]" aria-hidden>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end justify-center">
            <div className={`w-full max-w-[18px] rounded-t-[4px] ${i === values.length - 1 ? "bg-[#e60023]" : "bg-[#141414]"}`} style={{ height: v === 0 ? 3 : `${Math.max(8, (v / max) * 100)}%`, opacity: v === 0 ? 0.15 : 1 }} />
            <span className="pointer-events-none absolute -top-7 hidden whitespace-nowrap rounded-md bg-[#141414] px-1.5 py-0.5 text-[11px] font-semibold text-white group-hover:block">
              {v} · {days[i]?.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-medium text-[#9a978f]" aria-hidden>
        <span>{days[0]?.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        <span>Today</span>
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

function Row({ label, ok, on, off, loading, title }: { label: string; ok: boolean | undefined; on: string; off: string; loading: boolean; title?: string }) {
  return (
    <li className="flex items-center gap-2" title={title}>
      <span className={`h-2 w-2 rounded-full ${loading ? "bg-[#141414]/20" : ok ? "bg-emerald-600" : "bg-[#e60023]"}`} aria-hidden />
      <span className="font-medium text-[#141414]/70">{label}</span>
      <span className={`ml-auto whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold ${loading ? "text-[#141414]/50" : ok ? "bg-[#141414] text-white" : "bg-white/70 text-[#141414]"}`}>{loading ? "…" : ok ? on : off}</span>
    </li>
  );
}

