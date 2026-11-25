import "server-only";
import { parseSitemapOrFeed, pinnablePages, type FeedItem } from "./pageExtract";
import { parseShopifyProducts } from "./sources";
import { FetchBlocked, safeFetch } from "./safeFetch";

export interface SourceList {
  source: "shopify" | "sitemap" | "feed";
  from: string;
  urls: string[];
  items: FeedItem[];
}

async function text(url: string, accept: string) {
  const r = await safeFetch(url, { accept, maxBytes: 8_000_000 });
  return { ...r, body: r.status < 400 ? new TextDecoder().decode(r.bytes) : "" };
}

/**
 * Lists pages to pin from a sitemap, an RSS/Atom feed (blogs, WordPress) or a
 * Shopify store. Given just a site address, it tries the usual places. Read-only.
 * Throws FetchBlocked for unsafe addresses; returns null when nothing is found.
 */
export async function listSource(raw: string): Promise<SourceList | null> {
  const input = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
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
      if (items.length) return { source: "shopify", from: c, items, urls: items.map((i) => i.url) };
      continue;
    }
    const res = parseSitemapOrFeed(r.body, r.url);
    if (res.kind === "index") {
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
      if (pages.length) return { source: "sitemap", from: c, urls: pages, items: [] };
      continue;
    }
    if (res.kind === "sitemap") {
      const pages = pinnablePages(res.urls);
      if (pages.length) return { source: "sitemap", from: c, urls: pages, items: [] };
    }
    if (res.kind === "feed" && res.items.length) return { source: "feed", from: c, urls: res.urls.slice(0, 200), items: res.items.slice(0, 200) };
  }
  return null;
}
