/**
 * Reads what a pin needs from a web page, a sitemap or an RSS/Atom feed.
 * Plain string parsing (no DOM), tolerant of messy HTML. Pure and unit-tested;
 * fetching is done separately with safeFetch.
 */

export interface PageImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface PageInfo {
  url: string;
  canonical: string | null;
  siteName: string | null;
  kind: "product" | "article" | "page";
  title: string;
  description: string;
  headings: string[];
  keyPoints: string[];
  images: PageImage[];
  price: string | null;
  brand: string | null;
  keywords: string[];
  language: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

function metas(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") ?? attr(m[0], "name") ?? attr(m[0], "itemprop") ?? "").toLowerCase();
    const content = attr(m[0], "content");
    if (key && content && !out.has(key)) out.set(key, content);
  }
  return out;
}

function absolute(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Walks JSON-LD blocks and returns Product / Article data if present. */
function jsonLd(html: string): { type: string; name?: string; description?: string; image?: string[]; price?: string; brand?: string; keywords?: string[] }[] {
  const out: ReturnType<typeof jsonLd> = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length && out.length < 10) {
      const n = stack.pop();
      if (Array.isArray(n)) {
        stack.push(...n);
        continue;
      }
      if (!n || typeof n !== "object") continue;
      const o = n as Record<string, unknown>;
      if (o["@graph"]) stack.push(o["@graph"]);
      const t = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
      const type = t.find((x) => /Product|Article|BlogPosting|NewsArticle|Recipe|HowTo/i.test(x));
      if (!type) continue;
      const imgs = ([] as unknown[]).concat(o.image ?? []).map((i) => (typeof i === "string" ? i : (i as { url?: string })?.url)).filter((x): x is string => typeof x === "string");
      const offers = ([] as unknown[]).concat(o.offers ?? [])[0] as Record<string, unknown> | undefined;
      const price = offers?.price ?? (offers?.priceSpecification as Record<string, unknown> | undefined)?.price;
      const cur = offers?.priceCurrency ?? "";
      const brand = typeof o.brand === "string" ? o.brand : (o.brand as { name?: string } | undefined)?.name;
      const kw = typeof o.keywords === "string" ? o.keywords.split(",") : Array.isArray(o.keywords) ? o.keywords.map(String) : [];
      out.push({
        type,
        name: typeof o.name === "string" ? o.name : typeof o.headline === "string" ? o.headline : undefined,
        description: typeof o.description === "string" ? o.description : undefined,
        image: imgs,
        price: price != null ? `${price}${cur ? ` ${cur}` : ""}` : undefined,
        brand: brand ?? undefined,
        keywords: kw.map((k) => k.trim()).filter(Boolean),
      });
    }
  }
  return out;
}

const SKIP_IMG = /(logo|icon|sprite|avatar|favicon|badge|pixel|spacer|blank|placeholder|loader|emoji|gravatar|tracking|1x1|ads?[-_/])/i;

/** Extracts title, summary, key points, images and product data from page HTML. */
export function extractPage(html: string, pageUrl: string): PageInfo {
  const body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const meta = metas(html);
  const ld = jsonLd(html);
  const product = ld.find((x) => /Product/i.test(x.type));
  const article = ld.find((x) => !/Product/i.test(x.type));
  const canonicalTag = /<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html)?.[0];
  const canonical = canonicalTag ? absolute(attr(canonicalTag, "href") ?? "", pageUrl) : null;
  const titleTag = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const h1 = clean(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] ?? "");
  const siteName = meta.get("og:site_name") ?? null;
  let title = product?.name ?? meta.get("og:title") ?? (h1 || titleTag);
  if (siteName && title.endsWith(siteName)) title = title.slice(0, -siteName.length).replace(/[\s|–—-]+$/, "");
  title = decodeEntities(title).replace(/\s+/g, " ").trim().slice(0, 200);

  const headings = [...body.matchAll(/<h([2-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(m[2])).filter((h) => h.length > 3 && h.length < 140);
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter((p) => p.length > 60);
  const listItems = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => clean(m[1])).filter((l) => l.length > 15 && l.length < 200);
  const description = (product?.description ?? meta.get("og:description") ?? meta.get("description") ?? article?.description ?? paras[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

  const seen = new Set<string>();
  const images: PageImage[] = [];
  const add = (src: string | null | undefined, alt = "", w: number | null = null, h: number | null = null) => {
    const u = src ? absolute(src, pageUrl) : null;
    if (!u || seen.has(u) || SKIP_IMG.test(u) || /\.(svg|gif|ico)(\?|$)/i.test(u) || u.startsWith("data:")) return;
    if ((w !== null && w < 300) || (h !== null && h < 300)) return;
    seen.add(u);
    images.push({ url: u, alt: alt.slice(0, 200), width: w, height: h });
  };
  for (const i of product?.image ?? []) add(i, title);
  add(meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image"), title);
  for (const i of article?.image ?? []) add(i, title);
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    const largest = srcset
      ?.split(",")
      .map((s) => s.trim().split(/\s+/))
      .sort((a, b) => parseInt(b[1] ?? "0") - parseInt(a[1] ?? "0"))[0]?.[0];
    const w = Number(attr(tag, "width")) || null;
    const h = Number(attr(tag, "height")) || null;
    add(largest ?? attr(tag, "data-src") ?? attr(tag, "data-lazy-src") ?? attr(tag, "src"), attr(tag, "alt") ?? "", w, h);
    if (images.length >= 24) break;
  }

  const keyPoints = Array.from(new Set([...headings, ...listItems])).slice(0, 8);
  const kw = [...(product?.keywords ?? []), ...(article?.keywords ?? []), ...(meta.get("keywords")?.split(",") ?? [])].map((k) => k.trim()).filter((k) => k && k.length < 40);
  const lang = /<html\b[^>]*\slang\s*=\s*["']?([a-z-]+)/i.exec(html)?.[1] ?? null;
  const ogType = meta.get("og:type") ?? "";
  return {
    url: pageUrl,
    canonical,
    siteName,
    kind: product || /product/i.test(ogType) ? "product" : article || /article/i.test(ogType) ? "article" : "page",
    title: title || "Untitled page",
    description,
    headings: headings.slice(0, 12),
    keyPoints,
    images: images.slice(0, 12),
    price: product?.price ?? (meta.get("product:price:amount") ? `${meta.get("product:price:amount")} ${meta.get("product:price:currency") ?? ""}`.trim() : null),
    brand: product?.brand ?? null,
    keywords: Array.from(new Set(kw)).slice(0, 10),
    language: lang,
  };
}

/** Short, factual context for the text AI, so pins stay true to the page. */
export function pageContext(p: PageInfo): string {
  return [
    `Source page: ${p.canonical ?? p.url}`,
    p.siteName && `Site: ${p.siteName}`,
    `Page type: ${p.kind}`,
    `Page title: ${p.title}`,
    p.description && `Summary: ${p.description}`,
    p.price && `Price: ${p.price}`,
    p.brand && `Brand: ${p.brand}`,
    p.keyPoints.length && `Key points: ${p.keyPoints.slice(0, 6).join(" | ")}`,
    p.keywords.length && `Page keywords: ${p.keywords.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);
}

export interface FeedItem {
  url: string;
  title: string;
  summary: string;
  image: string | null;
  published: string | null;
}

/** Sitemap (urlset or sitemap index) → page URLs, or RSS/Atom → items. */
export function parseSitemapOrFeed(xml: string, base: string): { kind: "sitemap" | "index" | "feed" | "unknown"; urls: string[]; items: FeedItem[] } {
  const text = xml.slice(0, 5_000_000);
  if (/<sitemapindex\b/i.test(text)) {
    const urls = [...text.matchAll(/<sitemap\b[\s\S]*?<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => absolute(decodeEntities(m[1]), base)).filter((u): u is string => Boolean(u));
    return { kind: "index", urls, items: [] };
  }
  if (/<urlset\b/i.test(text)) {
    const urls = [...text.matchAll(/<url\b[\s\S]*?<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) => absolute(decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")), base)).filter((u): u is string => Boolean(u));
    return { kind: "sitemap", urls: Array.from(new Set(urls)), items: [] };
  }
  const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  if (blocks.length) {
    const val = (b: string, tag: string) => {
      const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(b);
      return m ? clean(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
    };
    const items = blocks.map((b) => {
      const atomLink = /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i.exec(b)?.[1];
      const link = val(b, "link") || atomLink || "";
      const raw = b.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
      const img =
        /<media:(?:content|thumbnail)\b[^>]*url\s*=\s*["']([^"']+)["']/i.exec(b)?.[1] ??
        /<enclosure\b[^>]*url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image/i.exec(b)?.[1] ??
        /<img\b[^>]*src\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] ??
        null;
      return {
        url: absolute(decodeEntities(link), base) ?? "",
        title: val(b, "title").slice(0, 200),
        summary: (val(b, "description") || val(b, "summary") || val(b, "content")).slice(0, 400),
        image: img ? absolute(decodeEntities(img), base) : null,
        published: val(b, "pubDate") || val(b, "published") || val(b, "updated") || null,
      };
    }).filter((i) => i.url);
    return { kind: "feed", urls: items.map((i) => i.url), items };
  }
  return { kind: "unknown", urls: [], items: [] };
}

/** Pages worth pinning from a sitemap: skips tags, authors, carts, feeds, legal pages and files. */
export function pinnablePages(urls: string[], limit = 200): string[] {
  const skip = /\/(tag|tags|author|category\/page|page\/\d+|cart|checkout|account|login|wp-admin|wp-json|feed|search|privacy|terms|cookie|contact)(\/|$)|\.(xml|jpg|jpeg|png|gif|webp|pdf|zip)(\?|$)/i;
  return urls.filter((u) => !skip.test(u)).slice(0, limit);
}
