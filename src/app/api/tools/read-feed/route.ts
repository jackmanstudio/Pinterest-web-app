import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { parseSitemapOrFeed, pinnablePages, type FeedItem } from "@/lib/tools/pageExtract";
import { parseShopifyProducts } from "@/lib/tools/sources";
import { FetchBlocked, safeFetch } from "@/lib/tools/safeFetch";

const Body = z.object({ url: z.string().trim().min(4).max(2048) });

async function text(url: string, accept: string) {
  const r = await safeFetch(url, { accept, maxBytes: 8_000_000 });
  return { ...r, body: r.status < 400 ? new TextDecoder().decode(r.bytes) : "" };
}

/**
 * Lists pages to pin from a sitemap, an RSS/Atom feed (blogs, WordPress) or a
 * Shopify store. Given just a site address, it tries the usual places. Read-only.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "urlCheck");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste a full web address." }, { status: 400 });
  try {
    await getRequestContext();
    const input = new URL(/^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`);
    const origin = input.origin;
    const isRoot = input.pathname === "/" || input.pathname === "";
    const candidates = isRoot
      ? [`${origin}/products.json?limit=100`, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`, `${origin}/feed`, `${origin}/rss.xml`]
      : [input.toString()];

    for (const c of candidates) {
      let r;
      try {
        r = await text(c, "application/xml,text/xml,application/rss+xml,application/atom+xml,application/json,*/*");
      } catch (e) {
        if (e instanceof FetchBlocked) throw e;
        continue;
      }
      if (!r.body) continue;
      if (/products\.json/.test(c) || /json/.test(r.contentType)) {
        const items = parseShopifyProducts(r.body, origin);
        if (items.length) return NextResponse.json({ source: "shopify", from: c, items, urls: items.map((i) => i.url) });
        continue;
      }
      const res = parseSitemapOrFeed(r.body, r.url);
      if (res.kind === "index") {
        // Read the first few child sitemaps (posts and products usually come first).
        const urls: string[] = [];
        const kids = res.urls.sort((a, b) => Number(/post|product|blog|recipe/i.test(b)) - Number(/post|product|blog|recipe/i.test(a))).slice(0, 4);
        for (const k of kids) {
          try {
            const kr = await text(k, "application/xml,text/xml");
            urls.push(...parseSitemapOrFeed(kr.body, kr.url).urls);
          } catch {
            /* skip one bad child */
          }
          if (urls.length > 400) break;
        }
        const pages = pinnablePages(Array.from(new Set(urls)));
        if (pages.length) return NextResponse.json({ source: "sitemap", from: c, urls: pages, items: [] as FeedItem[] });
        continue;
      }
      if (res.kind === "sitemap") {
        const pages = pinnablePages(res.urls);
        if (pages.length) return NextResponse.json({ source: "sitemap", from: c, urls: pages, items: [] as FeedItem[] });
      }
      if (res.kind === "feed" && res.items.length) return NextResponse.json({ source: "feed", from: c, urls: res.urls.slice(0, 200), items: res.items.slice(0, 200) });
    }
    return NextResponse.json({ error: isRoot ? "No sitemap, feed or store product list was found on that site. Paste the sitemap or feed address directly." : "That address isn't a sitemap, RSS/Atom feed or Shopify product list." }, { status: 422 });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof FetchBlocked) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Couldn't read that address." }, { status: 502 });
  }
}
