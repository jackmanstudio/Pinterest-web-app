"use client";
import { useState } from "react";
import type { FeedItem } from "@/lib/tools/pageExtract";

export interface SourceRow {
  id: string;
  url: string;
  kind: "feed" | "sitemap" | "shopify" | null;
  enabled: boolean;
  last_checked_at: string | null;
  last_error: string | null;
}

const KIND_LABEL = { feed: "Blog feed", sitemap: "Sitemap", shopify: "Shopify store" } as const;

/**
 * Content auto-sync: your blog feed, sitemap or Shopify store. Autopilot turns
 * each new page into pins with that page's link, facts and photos.
 */
export function ContentSources({
  sources,
  needsMigration,
  disabled,
  post,
}: {
  sources: SourceRow[];
  needsMigration: boolean;
  disabled: boolean;
  post: (payload: Record<string, unknown>, ok: string) => Promise<boolean>;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<{ source: string; items: FeedItem[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function look() {
    setLoading(true);
    setErr(null);
    setPreview(null);
    try {
      const res = await fetch("/api/tools/read-feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that address.");
      const items: FeedItem[] = body.items?.length ? body.items : body.urls.map((u: string) => ({ url: u, title: "", summary: "", image: null, published: null }));
      setPreview({ source: body.source, items: items.slice(0, 50) });
      setPicked(new Set(items.slice(0, 10).map((i) => i.url)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const titleOf = (i: FeedItem) => i.title || decodeURIComponent(new URL(i.url).pathname.split("/").filter(Boolean).pop() ?? i.url).replace(/[-_]+/g, " ");

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Your website, blog or store</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Add your site, its sitemap, an RSS feed or a Shopify store. When the idea queue is empty, Autopilot picks the next page it hasn&apos;t pinned yet and makes pins
        with that page&apos;s link, facts and photos.
      </p>
      {needsMigration && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">Run supabase/migrations/0012_content_sources.sql to turn this on.</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="src-url">Website, sitemap, feed or store</label>
        <input id="src-url" className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm" placeholder="https://yourblog.com  ·  /sitemap.xml  ·  /feed  ·  yourstore.myshopify.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button disabled={loading || url.trim().length < 4} onClick={look} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50">{loading ? "Reading…" : "Preview pages"}</button>
        <button disabled={disabled || url.trim().length < 8} onClick={() => post({ action: "add_source", url }, "Source added. Autopilot will check it for new pages.").then((ok) => ok && setUrl(""))} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Keep in sync</button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700" role="alert">{err}</p>}

      {preview && (
        <div className="mt-3 rounded-lg border border-zinc-200 p-3">
          <p className="text-sm"><strong>{preview.items.length}</strong> pages found ({preview.source}). Pick the ones to pin now:</p>
          <ul className="mt-2 max-h-72 divide-y divide-zinc-100 overflow-y-auto text-sm">
            {preview.items.map((i) => (
              <li key={i.url} className="flex items-center gap-2 py-1.5">
                <input type="checkbox" aria-label={titleOf(i)} checked={picked.has(i.url)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(i.url); else n.delete(i.url); return n; })} />
                {i.image && (
                  // eslint-disable-next-line @next/next/no-img-element -- external preview
                  <img src={i.image} alt="" className="h-9 w-7 flex-none rounded object-cover" referrerPolicy="no-referrer" loading="lazy" />
                )}
                <span className="min-w-0 flex-1 truncate">{titleOf(i)}</span>
                <a href={i.url} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline">open</a>
              </li>
            ))}
          </ul>
          <button
            disabled={disabled || picked.size === 0}
            onClick={() => {
              const pages = preview.items
                .filter((i) => picked.has(i.url))
                .map((i) => ({ idea: titleOf(i).slice(0, 480).padEnd(3, "."), link: i.url, context: i.summary ? `Source page: ${i.url}\nTitle: ${i.title}\nSummary: ${i.summary}` : undefined, image_urls: i.image ? [i.image] : [] }));
              post({ action: "add_pages", pages }, `Added ${pages.length} page${pages.length === 1 ? "" : "s"} to the queue.`).then((ok) => ok && setPreview(null));
            }}
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Add {picked.size} to the queue
          </button>
          <p className="mt-1 text-xs text-zinc-500">Use only photos and pages you own or have the rights to.</p>
        </div>
      )}

      {sources.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100 text-sm">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{s.kind ? KIND_LABEL[s.kind] : "Not checked yet"}</span>
              <span className="min-w-0 flex-1 truncate">{s.url}</span>
              <span className="text-xs text-zinc-500">{s.last_checked_at ? `checked ${new Date(s.last_checked_at).toLocaleString()}` : ""}</span>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={s.enabled} disabled={disabled} onChange={(e) => post({ action: "toggle_source", id: s.id, enabled: e.target.checked }, e.target.checked ? "Source on." : "Source paused.")} /> On
              </label>
              <button disabled={disabled} onClick={() => post({ action: "delete_source", id: s.id }, "Source removed.")} className="text-xs text-zinc-500 hover:text-red-700">Remove</button>
              {s.last_error && <span className="w-full text-xs text-amber-800">{s.last_error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
