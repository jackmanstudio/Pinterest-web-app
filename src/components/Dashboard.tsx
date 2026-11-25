"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStore } from "@/lib/store";
import { getDemoUser } from "@/lib/auth/demo";
import { STATUS_LABELS, WORKSPACE_KINDS, WORKSPACE_LABELS, type PinDraft, type WorkspaceKind } from "@/lib/types";

interface Counts { made: number; review: number; scheduled: number; published: number }
interface WsRow { kind: WorkspaceKind; name: string; counts: Counts; brand: boolean; connected: boolean | null }
interface Recent { draft: PinDraft; kind: WorkspaceKind; url: string | null }
interface Usage { ledger: string; budget_usd: number; spent_usd: number; recent: unknown[] }
interface Status { storage: "supabase" | "demo"; text: { source: string; provider: string }; image: { source: string; provider: string }; pinterest: { configured: boolean } }

const EMPTY: Counts = { made: 0, review: 0, scheduled: 0, published: 0 };

function count(drafts: PinDraft[]): Counts {
  const live = drafts.filter((d) => !d.archived_at);
  return {
    made: live.length,
    review: live.filter((d) => d.status === "in_review").length,
    scheduled: live.filter((d) => d.status === "scheduled").length,
    published: live.filter((d) => d.status === "published").length,
  };
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  in_review: "bg-amber-100 text-amber-800",
  approved: "bg-sky-100 text-sky-800",
  scheduled: "bg-violet-100 text-violet-800",
  published: "bg-emerald-100 text-emerald-800",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Home after sign-in: one look at every workspace, recent pins and what to do next. All numbers come from this app's own data. */
export function Dashboard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [hello, setHello] = useState("Welcome");
  const [mode, setMode] = useState<"supabase" | "demo" | null>(null);
  const [rows, setRows] = useState<WsRow[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [target, setTarget] = useState<WorkspaceKind>("fashion");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = getStore();
      setHello(greeting());
      setMode(store.mode);
      if (store.mode === "demo") {
        setName(getDemoUser()?.name ?? "");
      } else {
        const p: { full_name?: unknown } = await fetch("/api/auth/profile").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
        if (!cancelled && typeof p.full_name === "string") setName(p.full_name.split(" ")[0]);
      }
      fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then((u) => !cancelled && setUsage(u)).catch(() => {});
      fetch("/api/status").then((r) => (r.ok ? r.json() : null)).then((s) => !cancelled && setStatus(s)).catch(() => {});
      try {
        const all: { kind: WorkspaceKind; drafts: PinDraft[] }[] = [];
        const out: WsRow[] = [];
        for (const kind of WORKSPACE_KINDS) {
          const ws = await store.getWorkspace(kind);
          const [drafts, brand] = await Promise.all([store.listDrafts(ws.id), store.getBrand(ws.id)]);
          let connected: boolean | null = null;
          if (store.mode === "supabase") {
            const s = await fetch(`/api/pinterest/status?workspace=${kind}`).then((r) => r.json()).catch(() => ({}));
            connected = s.connection?.status === "active";
          }
          all.push({ kind, drafts });
          out.push({ kind, name: ws.name, counts: count(drafts), brand: Boolean(brand.brand_name?.trim() || brand.website_url?.trim()), connected });
        }
        const latest = all
          .flatMap(({ kind, drafts }) => drafts.filter((d) => !d.archived_at).map((draft) => ({ kind, draft })))
          .sort((a, b) => b.draft.created_at.localeCompare(a.draft.created_at))
          .slice(0, 8);
        const withUrls = await Promise.all(latest.map(async (r) => ({ ...r, url: await store.imageUrl(r.draft).catch(() => null) })));
        if (!cancelled) {
          setRows(out);
          setRecent(withUrls);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = (rows ?? []).reduce((t, r) => ({ made: t.made + r.counts.made, review: t.review + r.counts.review, scheduled: t.scheduled + r.counts.scheduled, published: t.published + r.counts.published }), EMPTY);

  function create(e: React.FormEvent) {
    e.preventDefault();
    const q = idea.trim();
    router.push(q ? `/w/${target}?idea=${encodeURIComponent(q)}` : `/w/${target}`);
  }

  const budget = usage?.budget_usd ?? 0;
  const spent = usage?.spent_usd ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-[#1f0f12] p-6 text-white shadow-[0_24px_48px_-24px_rgba(31,15,18,0.7)] sm:p-9">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-rose-600/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-rose-200/80">{hello}</p>
            <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight !text-white sm:text-4xl">{name ? `${name}, ready to make some pins?` : "Ready to make some pins?"}</h1>
            <p className="mt-3 max-w-xl text-sm text-white/65 sm:text-base">Type a keyword or product idea and the studio writes, designs and organises the pins for you.</p>
          </div>
          {mode === "demo" && <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-300/30">Demo mode · saved in this browser</span>}
        </div>
        <form onSubmit={create} className="relative mt-7 flex flex-col gap-2 rounded-2xl bg-white/[0.06] p-2 ring-1 ring-white/10 backdrop-blur sm:flex-row">
          <div className="flex shrink-0 gap-1 rounded-xl bg-black/20 p-1" role="radiogroup" aria-label="Workspace for the new pins">
            {WORKSPACE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={target === k}
                onClick={() => setTarget(k)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all ${target === k ? "bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-md shadow-rose-950/50" : "text-white/60 hover:text-white"}`}
              >
                {WORKSPACE_LABELS[k]}
              </button>
            ))}
          </div>
          <input
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. summer linen outfits, budget meal prep"
            aria-label="Pin idea"
            className="min-w-0 flex-1 rounded-xl border-0 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400"
          />
          <button className="rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 px-5 py-2.5 text-sm font-bold text-[#2a1416] shadow-lg shadow-amber-900/30 transition hover:brightness-105">✦ Create pins</button>
        </form>
      </section>

      {err && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Could not load your pins: {err}</p>}

      <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Pins made", value: total.made, href: `/w/${target}/drafts`, note: "All workspaces", tile: "from-rose-500 to-red-700", d: "M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z" },
          { label: "In review", value: total.review, href: `/w/${target}/publish`, note: "Waiting for your OK", tile: "from-amber-400 to-orange-600", d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
          { label: "Scheduled", value: total.scheduled, href: `/w/${target}/calendar`, note: "Queued for Pinterest", tile: "from-violet-500 to-indigo-700", d: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
          { label: "Published", value: total.published, href: `/w/${target}/analytics`, note: "Live on Pinterest", tile: "from-emerald-400 to-teal-700", d: "M4 12.5 9 17.5 20 6.5" },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
            <div aria-hidden className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${s.tile} opacity-[0.08] transition-opacity group-hover:opacity-[0.16]`} />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-600">{s.label}</p>
              <span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${s.tile} text-white shadow-md`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden><path d={s.d} /></svg>
              </span>
            </div>
            <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums text-zinc-900">{rows ? s.value : "–"}</p>
            <p className="mt-1 text-xs text-zinc-500">{s.note}</p>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent pins</h2>
            <Link href={`/w/${target}/drafts`} className="text-sm text-red-700 hover:underline">Open pin library</Link>
          </div>
          {!rows && !err && <p className="mt-4 text-sm text-zinc-500">Loading pins…</p>}
          {rows && recent.length === 0 && (
            <div className="mt-4 flex flex-col items-center rounded-2xl bg-gradient-to-b from-rose-50/70 to-white px-6 py-10 text-center ring-1 ring-rose-100">
              <div className="relative mb-4 h-20 w-24" aria-hidden>
                <div className="absolute left-1 top-3 h-16 w-11 -rotate-12 rounded-lg bg-gradient-to-br from-amber-200 to-amber-400 shadow-md" />
                <div className="absolute right-1 top-3 h-16 w-11 rotate-12 rounded-lg bg-gradient-to-br from-violet-200 to-violet-400 shadow-md" />
                <div className="absolute left-1/2 top-0 h-[4.5rem] w-12 -translate-x-1/2 rounded-lg bg-gradient-to-br from-rose-400 to-red-700 shadow-lg" />
              </div>
              <p className="font-semibold text-zinc-900">Your first pins will show up here</p>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">Type an idea in the box above and the studio makes a full set: title, description, tags and a designed image.</p>
            </div>
          )}
          {recent.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {recent.map(({ draft, kind, url }) => (
                <li key={draft.id}>
                  <Link href={`/w/${kind}/drafts`} className="group block">
                    <div className="aspect-[2/3] overflow-hidden rounded-xl bg-zinc-100 shadow-sm ring-1 ring-zinc-900/5 transition group-hover:shadow-lg">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={draft.alt_text || draft.title} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-500">{draft.image_status === "pending" ? "Image is being made…" : "No image yet"}</div>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs font-medium text-zinc-900">{draft.title || draft.idea}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[draft.status]}`}>{STATUS_LABELS[draft.status]}</span>
                      <span className="text-[10px] text-zinc-500">{WORKSPACE_LABELS[kind]}</span>
                      {draft.source === "demo" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Demo text</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">AI usage this month</h2>
              <Link href={`/w/${target}/usage`} className="text-sm text-red-700 hover:underline">Details</Link>
            </div>
            {usage ? (
              <>
                <p className="mt-3 text-2xl font-semibold tabular-nums">
                  ${spent.toFixed(2)} <span className="text-sm font-normal text-zinc-500">of ${budget.toFixed(2)} budget</span>
                </p>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
                  <div className={`h-full rounded-full bg-gradient-to-r ${pct >= 90 ? "from-rose-500 to-red-700" : pct >= 70 ? "from-amber-400 to-orange-500" : "from-emerald-400 to-teal-600"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {pct}% used · {usage.recent.length} recent AI calls{usage.ledger !== "supabase" ? " · tracked in this browser" : ""}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Loading usage…</p>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Connections</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <Conn label="Account storage" ok={status?.storage === "supabase"} on="Supabase connected" off="Demo: saved in this browser only" loading={!status} />
              <Conn label="AI writing" ok={status ? status.text.source === "ai" : undefined} on={status?.text.provider ?? ""} off="Demo text (labelled)" loading={!status} />
              <Conn label="AI images" ok={status ? status.image.source === "ai" : undefined} on={status?.image.provider ?? ""} off={status?.image.source === "error" ? "Needs setup" : "Demo images (labelled)"} loading={!status} />
              {(rows ?? WORKSPACE_KINDS.map((kind) => ({ kind, connected: null }) as Pick<WsRow, "kind" | "connected">)).map((r) => (
                <Conn
                  key={r.kind}
                  label={`Pinterest · ${WORKSPACE_LABELS[r.kind]}`}
                  ok={r.connected ?? false}
                  on="Connected"
                  off={!status ? "" : !status.pinterest.configured ? "App keys not set" : mode === "demo" ? "Needs Supabase first" : "Not connected"}
                  href={`/w/${r.kind}/pinterest`}
                  loading={!status}
                />
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section aria-label="Workspaces" className="grid gap-4 sm:grid-cols-2">
        {(rows ?? []).map((r) => (
          <div key={r.kind} className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5">
            <div aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${r.kind === "fashion" ? "from-rose-500 via-red-600 to-amber-400" : "from-violet-500 via-indigo-600 to-sky-400"}`} />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-md ${r.kind === "fashion" ? "from-rose-500 to-red-700" : "from-violet-500 to-indigo-700"}`}>{r.name.charAt(0)}</span>
                <div>
                  <h2 className="text-lg font-semibold leading-tight">{r.name}</h2>
                  <p className="text-xs text-zinc-500">{r.counts.made} pins · {r.brand ? "Brand set" : "Brand not set"}</p>
                </div>
              </div>
              <Link href={`/w/${r.kind}`} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
                Open studio
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
              {([["Made", r.counts.made], ["Review", r.counts.review], ["Scheduled", r.counts.scheduled], ["Published", r.counts.published]] as const).map(([l, v]) => (
                <div key={l} className="rounded-xl bg-zinc-50 py-2.5 ring-1 ring-zinc-900/[0.03]">
                  <dt className="text-[11px] text-zinc-500">{l}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {!r.brand && <Link href={`/w/${r.kind}/settings`} className="rounded-md bg-amber-50 px-2.5 py-1 text-amber-800 hover:bg-amber-100">Set up brand</Link>}
              <Link href={`/w/${r.kind}/publish`} className="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-700 hover:bg-zinc-200">Review & publish</Link>
              <Link href={`/w/${r.kind}/calendar`} className="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-700 hover:bg-zinc-200">Calendar</Link>
              <Link href={`/w/${r.kind}/boards`} className="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-700 hover:bg-zinc-200">Boards</Link>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Conn({ label, ok, on, off, href, loading }: { label: string; ok: boolean | undefined; on: string; off: string; href?: string; loading: boolean }) {
  const body = (
    <>
      <span className={`h-2 w-2 shrink-0 rounded-full ${loading ? "bg-zinc-300" : ok ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
      <span className="text-zinc-700">{label}</span>
      <span className="ml-auto truncate text-right text-xs text-zinc-500">{loading ? "Checking…" : ok ? on : off}</span>
    </>
  );
  return <li>{href ? <Link href={href} className="flex items-center gap-2 hover:underline">{body}</Link> : <div className="flex items-center gap-2">{body}</div>}</li>;
}
