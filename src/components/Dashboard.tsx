"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "./NavLink";
import { useRouter } from "next/navigation";
import { getDemoUser } from "@/lib/auth/demo";
import { isSupabaseConfigured } from "@/lib/supabase/config";
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
      // Demo mode never needs the Supabase client, so it isn't downloaded there.
      const store = isSupabaseConfigured ? (await import("@/lib/store")).getStore() : (await import("@/lib/store/demo")).getDemoStore();
      const now = new Date();
      const h = now.getHours();
      setToday(now);
      setHello(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
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
  const n = (v: number) => (pins ? v.toLocaleString() : "–");
  const glass = "au-glass rounded-2xl";
  const stats = [
    { label: "Live", v: count("published"), href: "analytics", dot: "bg-emerald-400", glow: "rgba(52,211,153,0.35)" },
    { label: "Scheduled", v: count("scheduled"), href: "calendar", dot: "bg-violet-400", glow: "rgba(167,139,250,0.4)" },
    { label: "In review", v: count("in_review"), href: "publish", dot: "bg-amber-300", glow: "rgba(252,211,77,0.35)" },
    { label: "Pins made", v: view.length, href: "drafts", dot: "bg-rose-400", glow: "rgba(251,113,133,0.4)" },
  ];
  const FRAME = ["from-orange-300 to-rose-600", "from-fuchsia-400 to-violet-700", "from-amber-200 to-orange-600", "from-rose-300 to-red-700", "from-violet-300 to-indigo-700"];

  return (
    <div className="flex flex-col gap-5">
      {/* Headline + create */}
      <section className="pt-2 sm:pt-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="au-glass inline-block min-w-[11rem] rounded-full px-3 py-1 text-center font-medium text-white/75">{dateLabel || "\u00a0"}</span>
          {!isSupabaseConfigured && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 font-semibold text-amber-200">Demo mode · this browser</span>}
          <div className="au-glass ml-auto flex gap-0.5 rounded-full p-0.5" role="radiogroup" aria-label="Show workspace">
            {(["all", ...WORKSPACE_KINDS] as Filter[]).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${filter === f ? "bg-[#fff] text-[#0b0912]" : "text-white/60 hover:text-white"}`}
              >
                {f === "all" ? "All" : WORKSPACE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-6 h-6 text-base font-semibold text-white/80">
          {hello}
          {name ? <>, <span className="au-grad">{name}</span></> : ""}
        </p>
        <h1 className="mt-1 text-[2.5rem] font-bold leading-[1.02] tracking-tight sm:text-6xl">
          Ready to make
          <br />
          some <span className="au-grad">pins</span>?
        </h1>
        <p className="mt-3 max-w-lg text-[15px] text-white/60">One idea in, finished pins out: title, description, tags and a designed image.</p>
        <form onSubmit={create} className={`${glass} mt-6 flex flex-col gap-2 p-2 shadow-[0_20px_60px_-20px_rgba(230,0,35,0.5)] sm:flex-row sm:items-center`}>
          <div className="flex shrink-0 gap-1 rounded-xl bg-black/25 p-1" role="radiogroup" aria-label="Workspace for new pins">
            {WORKSPACE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={target === k}
                onClick={() => setTarget(k)}
                className={`flex-1 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all ${target === k ? "bg-gradient-to-r from-[#e60023] to-[#ff7a45] text-white shadow-[0_6px_18px_-6px_rgba(255,90,60,0.8)]" : "text-white/60 hover:text-white"}`}
              >
                {WORKSPACE_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            ref={cmd}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={target === "fashion" ? "summer linen outfits…" : "budget meal prep…"}
            aria-label="Pin idea"
            className="min-w-0 flex-1 !border-0 !bg-transparent px-3 py-2.5 text-base text-white !shadow-none outline-none placeholder:text-white/40"
          />
          <button className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#fff] px-5 py-2.5 text-sm font-bold text-[#0b0912] transition hover:scale-[1.02]">✦ Create</button>
        </form>
      </section>

      {err && <p className="rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">Could not load your pins: {err}</p>}

      {/* Glass stats */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key numbers">
        {stats.map((st) => (
          <Link key={st.label} href={`/w/${ws}/${st.href}`} className={`${glass} group relative overflow-hidden p-4 transition hover:bg-white/[0.1] sm:p-5`}>
            <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl transition-opacity group-hover:opacity-100" style={{ background: st.glow, opacity: 0.6 }} />
            <p className="relative flex items-center gap-2 text-[13px] font-medium text-white/65">
              <span className={`h-2 w-2 rounded-full ${st.dot}`} aria-hidden />
              {st.label}
            </p>
            <p className="relative mt-3 font-[family-name:var(--font-display)] text-5xl font-bold leading-none tracking-tight tabular-nums text-white">{n(st.v)}</p>
          </Link>
        ))}
      </section>

      {/* Pins in glass frames */}
      <section className={`${glass} p-4 sm:p-5`}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Recent pins</h2>
          <Link href={`/w/${ws}/drafts`} className="text-xs font-medium text-white/60 hover:text-white">Open library →</Link>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => {
            const p = view[i];
            const url = p ? urls[p.draft.id] : null;
            return (
              <Link key={i} href={p ? `/w/${p.kind}/drafts` : `/w/${ws}`} className={`group rounded-2xl border border-white/10 bg-white/[0.05] p-1.5 transition hover:-translate-y-1 hover:bg-white/[0.1] ${i >= 3 ? "hidden sm:block" : ""}`}>
                <div className={`aspect-[2/3] overflow-hidden rounded-xl bg-gradient-to-br ${FRAME[i]} ${p ? "" : "opacity-40"}`}>
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={p!.draft.alt_text || p!.draft.title} className="h-full w-full object-cover" />
                  )}
                </div>
                <p className="mt-1.5 truncate px-1 text-xs font-medium text-white/80">{p ? p.draft.title || p.draft.idea : "Your next pin"}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Chart + side */}
      <div className="grid gap-3 lg:grid-cols-3">
        <section className={`${glass} p-5 lg:col-span-2`}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">Pins made, last 14 days</h2>
              <p className="text-xs text-white/50">{week} in the last 7 days</p>
            </div>
            <p className="font-[family-name:var(--font-display)] text-3xl font-bold tabular-nums">{n(sum(made))}</p>
          </div>
          <Bars values={made} days={days} />
        </section>
        <section className={`${glass} flex flex-col gap-4 p-5`}>
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">AI budget</h2>
              <Link href={`/w/${ws}/usage`} className="text-xs text-white/50 hover:text-white">Details</Link>
            </div>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tabular-nums">
              ${spent.toFixed(2)} <span className="text-sm font-medium text-white/70">/ ${budget.toFixed(2)}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
              <div className="h-full rounded-full bg-gradient-to-r from-[#e60023] to-[#ff9a5a]" style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
          </div>
          <div className="border-t border-white/10 pt-4">
            <h2 className="text-[15px] font-semibold">Connections</h2>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              <Row label="Storage" ok={status?.storage === "supabase"} on="Cloud" off="Browser" loading={!status} />
              <Row label="Writing" ok={status?.text.source === "ai"} on="Live" off="Demo" loading={!status} title={status?.text.provider} />
              <Row label="Images" ok={status?.image.source === "ai"} on="Live" off={status?.image.source === "error" ? "Setup" : "Demo"} loading={!status} title={status?.image.provider} />
              <Row label="Pinterest" ok={status?.pinterest.configured === true} on="Ready" off="Not set" loading={!status} />
            </ul>
          </div>
        </section>
      </div>

      {/* Workspaces */}
      <div className="grid gap-3 sm:grid-cols-2">
        {spaces.map((w) => {
          const mine = (pins ?? []).filter((p) => p.kind === w.kind);
          const next = !w.brand ? { href: `/w/${w.kind}/settings`, label: "Set up brand" } : w.connected !== true ? { href: `/w/${w.kind}/pinterest`, label: "Connect Pinterest" } : { href: `/w/${w.kind}`, label: "Make pins" };
          return (
            <section key={w.kind} className={`${glass} relative overflow-hidden p-5`}>
              <div aria-hidden className={`pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full blur-3xl ${w.kind === "fashion" ? "bg-rose-500/30" : "bg-violet-500/30"}`} />
              <div className="relative flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-xl text-sm font-bold text-white ${w.kind === "fashion" ? "bg-gradient-to-br from-[#e60023] to-[#ff7a45]" : "bg-gradient-to-br from-violet-500 to-indigo-600"}`}>{w.name.charAt(0)}</span>
                <div>
                  <h2 className="text-base font-semibold leading-tight">{w.name}</h2>
                  <p className="text-xs text-white/50">{mine.length} pins · {mine.filter((p) => p.draft.status === "in_review").length} review · {mine.filter((p) => p.draft.status === "published").length} live</p>
                </div>
                <Link href={`/w/${w.kind}`} className="ml-auto rounded-xl bg-[#fff] px-3.5 py-1.5 text-sm font-bold text-[#0b0912]">Open</Link>
              </div>
              <Link href={next.href} className="relative mt-4 flex items-center justify-between rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-[13px] text-white/80 ring-1 ring-white/10 hover:bg-white/[0.1]">
                Next: {next.label} <span aria-hidden>→</span>
              </Link>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, ok, on, off, loading, title }: { label: string; ok: boolean | undefined; on: string; off: string; loading: boolean; title?: string }) {
  return (
    <li className="flex items-center gap-2" title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${loading ? "bg-white/20" : ok ? "bg-emerald-400" : "bg-amber-300"}`} aria-hidden />
      <span className="text-white/60">{label}</span>
      <span className={`ml-auto whitespace-nowrap text-xs font-semibold ${loading ? "text-white/40" : ok ? "text-emerald-300" : "text-amber-200"}`}>{loading ? "…" : ok ? on : off}</span>
    </li>
  );
}

/** 14 thin columns; today on the right. Values are in each bar's tooltip and the hidden table. */
function Bars({ values, days }: { values: number[]; days: Date[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-4">
      <div className="flex h-36 items-end gap-[3px]" aria-hidden>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end justify-center">
            <div className="w-full max-w-[18px] rounded-t-[4px] bg-gradient-to-t from-[#e60023] to-[#ff9a5a]" style={{ height: v === 0 ? 3 : `${Math.max(8, (v / max) * 100)}%`, opacity: v === 0 ? 0.2 : 1 }} />
            <span className="pointer-events-none absolute -top-7 hidden whitespace-nowrap rounded-md border border-white/15 bg-[#1a1426] px-1.5 py-0.5 text-[11px] font-semibold text-white group-hover:block">
              {v} · {days[i]?.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-medium text-white/65" aria-hidden>
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

