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


const card = "rounded-3xl bg-[#f6f6f6]";

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
        const firstTen = all.slice(0, 30);
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
  const [status_, setStatus_] = useState<"all" | "draft" | "in_review" | "scheduled" | "published">("all");
  const wall = view.filter((p) => status_ === "all" || p.draft.status === status_ || (status_ === "draft" && p.draft.status === "approved")).slice(0, 30);
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

  const count = (st: string) => view.filter((p) => p.draft.status === st || (st === "draft" && p.draft.status === "approved")).length;
  const chips = [
    { k: "all" as const, label: "All pins", n: view.length },
    { k: "in_review" as const, label: "In review", n: count("in_review") },
    { k: "scheduled" as const, label: "Scheduled", n: count("scheduled") },
    { k: "published" as const, label: "Live", n: count("published") },
    { k: "draft" as const, label: "Drafts", n: count("draft") },
  ];
  const BADGE: Record<string, string> = {
    draft: "bg-white/95 text-[#111]",
    approved: "bg-white/95 text-[#111]",
    in_review: "bg-amber-300 text-[#111]",
    scheduled: "bg-[#111] text-white",
    published: "bg-[#e60023] text-white",
  };
  const PLACE = ["from-orange-300 to-rose-500", "from-violet-300 to-fuchsia-600", "from-teal-200 to-emerald-600", "from-amber-200 to-orange-500", "from-sky-200 to-indigo-500", "from-pink-200 to-rose-500", "from-lime-200 to-green-600", "from-rose-200 to-red-600"];
  const PH = [1.35, 1.6, 1.2, 1.5, 1.3, 1.55, 1.25, 1.45];
  const needsSetup = spaces.find((w) => !w.brand);

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[#767676]">{dateLabel}</p>
          <h1 className="text-[1.8rem] leading-tight sm:text-4xl">
            {hello}
            {name ? `, ${name}` : ""}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {mode === "demo" && <span className="whitespace-nowrap rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900" title="Saved in this browser only">Demo mode</span>}
          <div className="flex gap-1 rounded-full bg-[#efefef] p-1" role="radiogroup" aria-label="Show workspace">
            {(["all", ...WORKSPACE_KINDS] as Filter[]).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ${filter === f ? "bg-[#111] text-white" : "text-[#5f5f5f] hover:text-[#111]"}`}
              >
                {f === "all" ? "All" : WORKSPACE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Create bar */}
      <form onSubmit={create} className="flex flex-col gap-2 rounded-[1.75rem] bg-[#efefef] p-2 transition-shadow focus-within:shadow-[0_0_0_4px_rgba(0,0,0,0.06)] sm:flex-row sm:items-center sm:rounded-full">
        <div className="flex shrink-0 gap-1 rounded-full bg-white p-1" role="radiogroup" aria-label="Workspace for new pins">
          {WORKSPACE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={target === k}
              onClick={() => setTarget(k)}
              className={`flex-1 rounded-full px-4 py-1.5 text-[13px] font-bold ${target === k ? "bg-[#111] text-white" : "text-[#5f5f5f]"}`}
            >
              {WORKSPACE_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[#767676]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={cmd}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={target === "fashion" ? "What do you want to pin today? e.g. summer linen outfits" : "What do you want to pin today? e.g. budget meal prep"}
            aria-label="Pin idea"
            className="min-w-0 flex-1 !border-0 !bg-transparent py-2 text-base font-medium text-[#111] !shadow-none outline-none placeholder:font-normal placeholder:text-[#767676]"
          />
        </div>
        <button className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#e60023] px-6 py-3 text-[15px] font-bold text-white transition hover:bg-[#cc001f]">
          Create
        </button>
      </form>

      {/* Status chips */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="radiogroup" aria-label="Filter pins">
        {chips.map((c) => (
          <button
            key={c.k}
            role="radio"
            aria-checked={status_ === c.k}
            onClick={() => setStatus_(c.k)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-colors ${status_ === c.k ? "bg-[#111] text-white" : "bg-[#efefef] text-[#111] hover:bg-[#e2e2e2]"}`}
          >
            {c.label}
            <span className={`ml-1.5 tabular-nums ${status_ === c.k ? "text-white/70" : "text-[#767676]"}`}>{pins ? c.n : "–"}</span>
          </button>
        ))}
        {needsSetup && (
          <Link href={`/w/${needsSetup.kind}/settings`} className="ml-auto shrink-0 rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900 hover:bg-amber-200">
            Set up {needsSetup.name} brand →
          </Link>
        )}
      </div>

      {err && <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">Could not load your pins: {err}</p>}

      {/* Wall */}
      {!pins && !err && (
        <div className="pw-wall">
          {PH.map((h, i) => <div key={i} className="animate-pulse rounded-2xl bg-[#efefef]" style={{ aspectRatio: `1 / ${h}` }} />)}
        </div>
      )}
      {pins && wall.length === 0 && (
        <div className="relative overflow-hidden rounded-3xl">
          <div className="pw-wall pointer-events-none opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden>
            {PH.concat(PH).slice(0, 10).map((h, i) => <div key={i} className={`rounded-2xl bg-gradient-to-br ${PLACE[i % PLACE.length]}`} style={{ aspectRatio: `1 / ${h}` }} />)}
          </div>
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="max-w-sm rounded-3xl bg-white p-6 text-center shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
              <p className="font-[family-name:var(--font-display)] text-xl font-bold">{status_ === "all" ? "Your pin wall is empty" : `No ${chips.find((c) => c.k === status_)?.label.toLowerCase()} pins`}</p>
              <p className="mt-1 text-sm text-[#5f5f5f]">Type an idea in the bar above and your designed pins appear here.</p>
              <button onClick={() => cmd.current?.focus()} className="mt-4 rounded-full bg-[#e60023] px-5 py-2.5 text-sm font-bold text-white">Make my first pins</button>
            </div>
          </div>
        </div>
      )}
      {wall.length > 0 && (
        <ul className="pw-wall">
          {wall.map(({ draft, kind }, i) => (
            <li key={draft.id} className="group" style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
              <div className="relative overflow-hidden rounded-2xl bg-[#efefef]">
                {urls[draft.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[draft.id]!} alt={draft.alt_text || draft.title} className="block aspect-[2/3] w-full object-cover" loading="lazy" />
                ) : (
                  <div className={`grid aspect-[2/3] place-items-center bg-gradient-to-br p-4 text-center text-sm font-bold text-white ${PLACE[i % PLACE.length]}`}>{draft.image_status === "pending" ? "Making image…" : draft.title || draft.idea}</div>
                )}
                <span className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm ${BADGE[draft.status]}`}>{STATUS_LABELS[draft.status]}</span>
                <div className="absolute inset-0 flex flex-col justify-between bg-black/40 p-2.5 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
                  <div className="flex justify-end">
                    <Link href={`/w/${kind}/drafts`} className="rounded-full bg-[#e60023] px-4 py-2 text-sm font-bold text-white hover:bg-[#cc001f]">Open</Link>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/w/${kind}/publish`} className="flex-1 rounded-full bg-white/95 px-3 py-2 text-center text-xs font-bold text-[#111] hover:bg-white">Review</Link>
                    <Link href={`/w/${kind}/calendar`} className="flex-1 rounded-full bg-white/95 px-3 py-2 text-center text-xs font-bold text-[#111] hover:bg-white">Schedule</Link>
                  </div>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 px-1 text-[13px] font-semibold leading-snug text-[#111]">{draft.title || draft.idea}</p>
              <p className="px-1 text-xs text-[#767676]">
                {WORKSPACE_LABELS[kind]}
                {draft.source === "demo" ? " · Demo text" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {view.length > wall.length && status_ === "all" && (
        <div className="flex justify-center">
          <Link href={`/w/${ws}/drafts`} className="rounded-full bg-[#efefef] px-5 py-2.5 text-sm font-bold text-[#111] hover:bg-[#e2e2e2]">See all {view.length} pins</Link>
        </div>
      )}

      {/* Footer info */}
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">This week</h2>
            <span className="text-xs font-semibold text-[#767676]">{filter === "all" ? "All" : WORKSPACE_LABELS[filter]}</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="font-[family-name:var(--font-display)] text-4xl font-bold tabular-nums">{sum(made.slice(-7))}</p>
              <p className="text-xs text-[#767676]">pins made in 7 days</p>
            </div>
            <MiniBars values={made} />
          </div>
        </section>
        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">AI budget</h2>
            <Link href={`/w/${ws}/usage`} className="text-xs font-semibold text-[#767676] hover:text-[#111]">Details</Link>
          </div>
          <p className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tabular-nums">
            ${spent.toFixed(2)}
            <span className="ml-1 text-sm font-medium text-[#767676]">of ${budget.toFixed(2)}</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
            <div className={`h-full rounded-full ${pct >= 90 ? "bg-[#e60023]" : pct >= 70 ? "bg-amber-500" : "bg-[#111]"}`} style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
        </section>
        <section className={`${card} p-5`}>
          <h2 className="text-base font-bold">Connections</h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <Row label="Storage" ok={status?.storage === "supabase"} on="Cloud" off="Browser" loading={!status} />
            <Row label="Writing" ok={status?.text.source === "ai"} on="Live" off="Demo" loading={!status} title={status?.text.provider} />
            <Row label="Images" ok={status?.image.source === "ai"} on="Live" off={status?.image.source === "error" ? "Setup" : "Demo"} loading={!status} title={status?.image.provider} />
            <Row label="Pinterest" ok={status?.pinterest.configured === true} on="Ready" off="Not set" loading={!status} />
          </ul>
        </section>
      </div>
    </div>
  );
}

/** Seven small bars for the last 7 days; values are in the hover title. */
function MiniBars({ values }: { values: number[] }) {
  const v = values.slice(-7);
  const max = Math.max(1, ...v);
  return (
    <div className="flex h-12 items-end gap-1" role="img" aria-label={`Pins per day, last 7 days: ${v.join(", ")}`}>
      {v.map((x, i) => (
        <span key={i} title={`${x} pin${x === 1 ? "" : "s"}`} className={`w-3 rounded-t-[4px] ${i === v.length - 1 ? "bg-[#e60023]" : "bg-[#111]"}`} style={{ height: `${Math.max(6, (x / max) * 100)}%`, opacity: x === 0 ? 0.15 : 1 }} />
      ))}
    </div>
  );
}

function Row({ label, ok, on, off, loading, title }: { label: string; ok: boolean | undefined; on: string; off: string; loading: boolean; title?: string }) {
  return (
    <li className="flex items-center gap-2" title={title}>
      <span className={`h-2 w-2 rounded-full ${loading ? "bg-zinc-300" : ok ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
      <span className="text-[#5f5f5f]">{label}</span>
      <span className={`ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${loading ? "text-[#767676]" : ok ? "bg-emerald-100 text-emerald-800" : "bg-white text-[#111]"}`}>{loading ? "…" : ok ? on : off}</span>
    </li>
  );
}

