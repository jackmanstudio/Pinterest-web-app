"use client";
import { PageTitle } from "./PageTitle";
import { useEffect, useMemo, useState } from "react";
import type { AuditEvent, Category, PinDraft, WorkspaceKind } from "@/lib/types";
import { labelFromSlug } from "@/lib/types";
import { buildUtmUrl, slugify, UTM_DEFAULTS, type UtmFields } from "@/lib/tools/utm";
import { IMPORT_TEMPLATE, validateImport, type ImportReport } from "@/lib/tools/csv";
import type { UrlCheckResult } from "@/lib/tools/urlCheck";
import { AMAZON_STORES, DEFAULT_AFFILIATE, addDisclosure, applyAmazonTag, looksAffiliate, replaceInLink, validTag, type AffiliateSettings } from "@/lib/tools/affiliate";
import { CopyButton } from "./CopyButton";
import { downloadFile } from "@/lib/client/download";
import { useWorkspace } from "./useWorkspace";

const card = "flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm";
const input = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm";

export function Tools({ kind }: { kind: WorkspaceKind }) {
  const { store, workspace, error } = useWorkspace(kind);
  const [drafts, setDrafts] = useState<PinDraft[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    if (!store || !workspace) return;
    Promise.all([store.listDrafts(workspace.id), store.listCategories(workspace.id)]).then(([d, c]) => {
      setDrafts(d);
      setCategories(c);
    }).catch(() => {});
  }, [store, workspace]);

  if (error) return <p className="text-red-700">Could not load workspace: {error}</p>;
  if (!store || !workspace) return <p className="text-zinc-500">Loading tools…</p>;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle kind={kind} title="Pin" accent="tools" sub="Check links, add UTM tags, manage affiliate links and import or export pins." />
      <div className="grid gap-6 lg:grid-cols-2">
        <LinkChecker />
        <UtmBuilder drafts={drafts} onApplied={setDrafts} apply={(id, link) => store.updateDraft(workspace.id, id, { link })} />
      </div>
      <AffiliateTools
        kind={kind}
        drafts={drafts}
        onApplied={setDrafts}
        apply={(id, patch) => store.updateDraft(workspace.id, id, patch)}
      />
      <CsvImport
        kind={kind}
        categories={categories}
        onImport={async (rows) => {
          const batch = crypto.randomUUID();
          const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
          const saved = await store.saveDrafts(
            workspace.id,
            rows.map((r) => ({
              idea: r.idea, title: r.title, description: r.description, tags: r.tags, alt_text: r.alt_text, link: r.link,
              angle: "Imported", concept: "Imported from CSV", image_prompt: `A clean, styled vertical photograph that shows: ${r.title}`, batch_id: batch,
              category_id: byName.get(r.category.toLowerCase()) ?? null, source: "manual",
            })),
          );
          setDrafts((d) => [...saved, ...d]);
          return saved.length;
        }}
      />
      <ActivityLog load={() => store.listActivity(workspace.id)} drafts={drafts} demo={store.mode === "demo"} />
    </div>
  );
}

function LinkChecker() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<UrlCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/tools/check-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, title }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Check failed");
      setRes(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tone = !res ? "" : res.reachable ? "text-emerald-700" : res.reachable === false ? "text-red-700" : "text-amber-700";
  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">Destination link checker</h2>
      <p className="text-sm text-zinc-600">Checks the address, whether the page opens, redirects, and if the page title fits your pin.</p>
      <input className={input} placeholder="https://your-site.com/post" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input className={input} placeholder="Pin title (optional, for the topic match)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button onClick={run} disabled={busy || !url.trim()} className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
        {busy ? "Checking…" : "Check link"}
      </button>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {res && (
        <div className="rounded-md bg-zinc-50 p-3 text-sm">
          <p className={`font-medium ${tone}`}>
            {!res.syntaxOk ? "Invalid address" : res.reachable ? `Page opens (status ${res.status})` : res.status ? `Problem: status ${res.status}` : "Could not check the page"}
          </p>
          {res.pageTitle && <p className="text-zinc-700">Page title: “{res.pageTitle}”{res.topicMatch === "match" ? " · matches the pin" : res.topicMatch === "weak" ? " · weak match" : ""}</p>}
          <ul className="mt-1 list-disc pl-5 text-zinc-700">{res.messages.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-1 text-xs text-zinc-500">A page that opens is not proof that it is safe or allowed on Pinterest.</p>
        </div>
      )}
    </section>
  );
}

function UtmBuilder({ drafts, apply, onApplied }: { drafts: PinDraft[]; apply: (id: string, link: string) => Promise<PinDraft>; onApplied: (d: PinDraft[]) => void }) {
  const [url, setUrl] = useState("");
  const [f, setF] = useState<UtmFields>(UTM_DEFAULTS);
  const [msg, setMsg] = useState<string | null>(null);
  let built = "";
  let err = "";
  try {
    if (url.trim()) built = buildUtmUrl(url, f);
  } catch {
    err = "Enter a full address starting with https://";
  }
  const base = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.origin}${x.pathname}`;
    } catch {
      return "";
    }
  };
  const targets = built ? drafts.filter((d) => d.link && base(d.link) === base(built) && ["draft", "in_review", "approved"].includes(d.status) && !d.archived_at) : [];
  async function applyAll() {
    let next = drafts;
    for (const d of targets) {
      const u = await apply(d.id, buildUtmUrl(d.link!, { ...f, content: f.content || slugify(d.title) }));
      next = next.map((x) => (x.id === u.id ? u : x));
    }
    onApplied(next);
    setMsg(`Added tracking to ${targets.length} pin${targets.length === 1 ? "" : "s"}. Approved pins go back to draft for a new review.`);
  }
  const field = (k: keyof UtmFields, label: string, ph: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
      {label}
      <input className={input} placeholder={ph} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">UTM link builder</h2>
      <p className="text-sm text-zinc-600">Adds tracking tags so Google Analytics shows which visits came from Pinterest. Existing parameters are kept.</p>
      <input className={input} placeholder="https://your-site.com/post" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        {field("source", "Source", "pinterest")}
        {field("medium", "Medium", "social")}
        {field("campaign", "Campaign", "autumn-2026")}
        {field("content", "Content (blank = pin title)", "trench-coat-pin")}
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {built && (
        <div className="rounded-md bg-zinc-50 p-2 text-xs break-all">
          {built} <CopyButton text={built} className="ml-1" />
        </div>
      )}
      {targets.length > 0 && (
        <button onClick={applyAll} className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50">
          Add these tags to {targets.length} unpublished pin{targets.length === 1 ? "" : "s"} with this link
        </button>
      )}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
    </section>
  );
}

function CsvImport({ kind, categories, onImport }: { kind: WorkspaceKind; categories: Category[]; onImport: (rows: ImportReport["valid"]) => Promise<number> }) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const known = new Set(categories.map((c) => c.name.toLowerCase()));
  return (
    <section id="import" className={card}>
      <h2 className="text-lg font-semibold">Bulk import pins from CSV</h2>
      <p className="text-sm text-zinc-600">
        Columns: <code>idea</code> or <code>title</code> (required), <code>description</code>, <code>tags</code>, <code>alt_text</code>, <code>link</code>, <code>category</code>.
        Rows are checked first; nothing is saved until you press Import. Imported pins are drafts in {labelFromSlug(kind)} only.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={async (e) => {
            setMsg(null);
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) return setMsg({ text: "File is over 1 MB.", ok: false });
            setReport(validateImport(await file.text()));
          }}
        />
        <button onClick={() => downloadFile("pin-import-template.csv", IMPORT_TEMPLATE)} className="text-sm underline">Download template</button>
      </div>
      {report?.fatal && <p className="text-sm text-red-700">{report.fatal}</p>}
      {report && !report.fatal && (
        <>
          <p className="text-sm">
            <strong>{report.valid.length}</strong> of {report.rows.length} rows are ready.{" "}
            {report.rows.length - report.valid.length > 0 && <span className="text-red-700">{report.rows.length - report.valid.length} will be skipped.</span>}
          </p>
          <div className="max-h-72 overflow-auto rounded-md border border-zinc-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-50">
                <tr><th className="p-1.5">Row</th><th className="p-1.5">Title</th><th className="p-1.5">Category</th><th className="p-1.5">Link</th><th className="p-1.5">Check</th></tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.line} className="border-t border-zinc-100 align-top">
                    <td className="p-1.5">{r.line}</td>
                    <td className="p-1.5">{r.title}</td>
                    <td className="p-1.5">{r.category ? (known.has(r.category.toLowerCase()) ? r.category : <span className="text-amber-700">{r.category} (not found, left empty)</span>) : "—"}</td>
                    <td className="p-1.5 break-all">{r.link ?? "—"}</td>
                    <td className={`p-1.5 ${r.errors.length ? "text-red-700" : r.warnings.length ? "text-amber-700" : "text-emerald-700"}`}>
                      {[...r.errors, ...r.warnings].join("; ") || "OK"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || !report.valid.length}
            onClick={async () => {
              setBusy(true);
              try {
                const n = await onImport(report.valid);
                setMsg({ text: `Imported ${n} pins as drafts. Open the Pin library to add images.`, ok: true });
                setReport(null);
              } catch (e) {
                setMsg({ text: (e as Error).message, ok: false });
              } finally {
                setBusy(false);
              }
            }}
            className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {busy ? "Importing…" : `Import ${report.valid.length} rows`}
          </button>
        </>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  submit: "Sent for review", approve: "Approved", request_changes: "Changes requested", withdraw: "Withdrawn", schedule: "Scheduled",
  publish_now: "Publish requested", cancel_schedule: "Schedule cancelled", published: "Published", publish_failed: "Publish failed",
};

function ActivityLog({ load, drafts, demo }: { load: () => Promise<AuditEvent[]>; drafts: PinDraft[]; demo: boolean }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    load().then(setEvents).catch((e: Error) => setErr(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const titles = useMemo(() => new Map(drafts.map((d) => [d.id, d.title])), [drafts]);
  const actions = [...new Set((events ?? []).map((e) => e.action))];
  const shown = (events ?? []).filter(
    (e) => (!action || e.action === action) && (!q || `${titles.get(e.target_id ?? "") ?? ""} ${JSON.stringify(e.details)}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Activity log</h2>
        <select aria-label="Action" className={`${input} ml-auto`} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] ?? a.replace(/_/g, " ")}</option>)}
        </select>
        <input aria-label="Search activity" className={input} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="text-xs text-zinc-500">Approvals, schedules, publishing and Autopilot actions in this workspace. {demo ? "Demo mode records only review steps in this browser." : "Kept in the database; entries can't be edited."}</p>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {events && shown.length === 0 && <p className="text-sm text-zinc-600">No activity yet.</p>}
      <ul className="flex max-h-96 flex-col divide-y divide-zinc-100 overflow-y-auto text-sm">
        {shown.map((e) => {
          const d = e.details as Record<string, unknown>;
          return (
            <li key={e.id} className="flex flex-wrap gap-x-3 py-1.5">
              <span className="w-40 shrink-0 text-xs text-zinc-500">{new Date(e.created_at).toLocaleString()}</span>
              <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action.replace(/_/g, " ")}</span>
              <span className="text-zinc-700">{titles.get(e.target_id ?? "") ?? (e.target_type && e.target_type !== "pin_draft" ? e.target_type : "")}</span>
              {d.autopilot ? <span className="rounded bg-zinc-100 px-1 text-xs">Autopilot</span> : null}
              {typeof d.error === "string" && <span className="text-xs text-red-700">{d.error}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type AffPatch = { link?: string; description?: string };
const editable = (d: PinDraft) => ["draft", "in_review", "approved"].includes(d.status) && !d.archived_at;

function AffiliateTools({ kind, drafts, apply, onApplied }: { kind: WorkspaceKind; drafts: PinDraft[]; apply: (id: string, patch: AffPatch) => Promise<PinDraft>; onApplied: (d: PinDraft[]) => void }) {
  const key = `pas-affiliate-${kind}`;
  // Mounted only after the workspace loads in the browser, so localStorage is available here.
  const [s, setS] = useState<AffiliateSettings>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...DEFAULT_AFFILIATE, ...JSON.parse(raw) } : DEFAULT_AFFILIATE;
    } catch {
      return DEFAULT_AFFILIATE;
    }
  });
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  function save(next: AffiliateSettings) {
    setS(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }
  const badTags = Object.entries(s.amazonTags).filter(([, t]) => t.trim() && !validTag(t));

  const tagChanges = useMemo(() => {
    const out: { d: PinDraft; patch: AffPatch }[] = [];
    for (const d of drafts.filter(editable)) {
      const patch: AffPatch = {};
      if (d.link) {
        const l = applyAmazonTag(d.link, s.amazonTags);
        if (l !== d.link) patch.link = l;
      }
      if (looksAffiliate(patch.link ?? d.link)) {
        const desc = addDisclosure(d.description, s.disclosure);
        if (desc !== d.description) patch.description = desc;
      }
      if (patch.link || patch.description) out.push({ d, patch });
    }
    return out;
  }, [drafts, s]);

  const replaceChanges = useMemo(() => {
    if (!find) return { ok: [] as { d: PinDraft; patch: AffPatch }[], bad: 0 };
    let bad = 0;
    const ok: { d: PinDraft; patch: AffPatch }[] = [];
    for (const d of drafts.filter(editable)) {
      if (!d.link || !d.link.includes(find)) continue;
      const l = replaceInLink(d.link, find, repl);
      if (l === null) bad++;
      else if (l !== d.link) ok.push({ d, patch: { link: l } });
    }
    return { ok, bad };
  }, [drafts, find, repl]);

  async function run(list: { d: PinDraft; patch: AffPatch }[], what: string) {
    setBusy(true);
    setMsg(null);
    let next = drafts;
    let done = 0;
    try {
      for (const { d, patch } of list) {
        const u = await apply(d.id, patch);
        next = next.map((x) => (x.id === u.id ? u : x));
        done++;
      }
      setMsg(`${what} on ${done} pin${done === 1 ? "" : "s"}. Approved pins go back to draft for a new review.`);
    } catch (e) {
      setMsg(`Stopped after ${done} pin${done === 1 ? "" : "s"}: ${e instanceof Error ? e.message : "save failed"}`);
    } finally {
      onApplied(next);
      setBusy(false);
    }
  }
  const btn = "self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50";
  return (
    <section className={card}>
      <h2 className="text-lg font-semibold">Affiliate links</h2>
      <p className="text-sm text-zinc-600">
        Add your Amazon tag per country and an #ad disclosure to unpublished pins, or change a link in bulk. Your links are always kept; only pins not yet
        published are changed, and only when you press a button. Settings are saved in this browser.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Amazon tags</h3>
          <div className="grid grid-cols-2 gap-2">
            {AMAZON_STORES.map((st) => (
              <label key={st.domain} className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
                {st.label} <span className="font-normal text-zinc-500">{st.domain}</span>
                <input
                  className={input}
                  placeholder="yourtag-20"
                  value={s.amazonTags[st.domain] ?? ""}
                  onChange={(e) => save({ ...s, amazonTags: { ...s.amazonTags, [st.domain]: e.target.value } })}
                />
              </label>
            ))}
          </div>
          {badTags.length > 0 && <p className="text-sm text-red-700">These tags look wrong (3–40 letters, numbers or dashes): {badTags.map(([dm]) => dm).join(", ")}</p>}
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
            Disclosure added to affiliate pins
            <input className={input} value={s.disclosure} onChange={(e) => save({ ...s, disclosure: e.target.value })} />
          </label>
          {tagChanges.length > 0 ? (
            <>
              <ul className="max-h-48 overflow-y-auto rounded-md bg-zinc-50 p-2 text-xs">
                {tagChanges.slice(0, 30).map(({ d, patch }) => (
                  <li key={d.id} className="py-0.5">
                    <span className="font-medium">{d.title}</span>
                    {patch.link && <span className="text-zinc-600"> · tag added</span>}
                    {patch.description && <span className="text-zinc-600"> · disclosure added</span>}
                  </li>
                ))}
                {tagChanges.length > 30 && <li className="py-0.5 text-zinc-500">…and {tagChanges.length - 30} more</li>}
              </ul>
              <button className={btn} disabled={busy} onClick={() => run(tagChanges, "Updated tags and disclosure")}>
                Apply to {tagChanges.length} unpublished pin{tagChanges.length === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <p className="text-sm text-zinc-500">No unpublished pins need a tag or disclosure right now.</p>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Change links in bulk</h3>
          <p className="text-xs text-zinc-600">For a moved site, a changed shop domain or a new affiliate ID. Exact text match inside each link.</p>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
            Find
            <input className={input} placeholder="old-shop.com or oldtag-20" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-700">
            Replace with
            <input className={input} placeholder="new-shop.com or newtag-20" value={repl} onChange={(e) => setRepl(e.target.value)} />
          </label>
          {find && (
            <>
              <ul className="max-h-48 overflow-y-auto rounded-md bg-zinc-50 p-2 text-xs break-all">
                {replaceChanges.ok.slice(0, 20).map(({ d, patch }) => (
                  <li key={d.id} className="py-0.5">
                    <span className="font-medium">{d.title}</span> → {patch.link}
                  </li>
                ))}
                {replaceChanges.ok.length === 0 && <li className="text-zinc-500">No unpublished pin links contain this text.</li>}
              </ul>
              {replaceChanges.bad > 0 && <p className="text-sm text-amber-700">{replaceChanges.bad} link{replaceChanges.bad === 1 ? "" : "s"} would break and will be skipped.</p>}
              {replaceChanges.ok.length > 0 && (
                <button className={btn} disabled={busy} onClick={() => run(replaceChanges.ok, "Changed links")}>
                  Change {replaceChanges.ok.length} link{replaceChanges.ok.length === 1 ? "" : "s"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
    </section>
  );
}
