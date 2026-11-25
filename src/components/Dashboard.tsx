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
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-red-700 via-red-600 to-rose-500 p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-red-100">{hello}</p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{name ? `${name}, ready to make some pins?` : "Ready to make some pins?"}</h1>
            <p className="mt-2 max-w-xl text-sm text-red-50">Type a keyword or product idea and the studio writes, designs and organises the pins for you.</p>
          </div>
          {mode === "demo" && <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium">Demo mode · saved in this browser</span>}
        </div>
        <form onSubmit={create} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <div className="flex shrink-0 gap-1 rounded-lg bg-white/15 p-1" role="radiogroup" aria-label="Workspace for the new pins">
            {WORKSPACE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={target === k}
                onClick={() => setTarget(k)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${target === k ? "bg-white text-red-700" : "text-white hover:bg-white/10"}`}
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
            className="min-w-0 flex-1 rounded-lg border-0 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-white/60"
          />
          <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">Create pins</button>
        </form>
      </section>

      {err && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Could not load your pins: {err}</p>}

      <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Pins made", value: total.made, href: `/w/${target}/drafts`, note: "All workspaces" },
          { label: "In review", value: total.review, href: `/w/${target}/publish`, note: "Waiting for your OK" },
          { label: "Scheduled", value: total.scheduled, href: `/w/${target}/calendar`, note: "Queued for Pinterest" },
          { label: "Published", value: total.published, href: `/w/${target}/analytics`, note: "Live on Pinterest" },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300">
            <p className="text-sm text-zinc-600">{s.label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-900">{rows ? s.value : "–"}</p>
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
            <div className="mt-4 rounded-lg border border-dashed border-zinc-300 p-6 text-center">
              <p className="text-sm text-zinc-600">No pins yet. Type an idea above to make your first set.</p>
            </div>
          )}
          {recent.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {recent.map(({ draft, kind, url }) => (
                <li key={draft.id}>
                  <Link href={`/w/${kind}/drafts`} className="group block">
                    <div className="aspect-[2/3] overflow-hidden rounded-lg bg-zinc-100">
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
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Budget used">
                  <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-600" : pct >= 70 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
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
          <div key={r.kind} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{r.name}</h2>
              <Link href={`/w/${r.kind}`} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
                Open studio
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
              {([["Made", r.counts.made], ["Review", r.counts.review], ["Scheduled", r.counts.scheduled], ["Published", r.counts.published]] as const).map(([l, v]) => (
                <div key={l} className="rounded-lg bg-zinc-50 py-2">
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
