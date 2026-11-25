import { describe, expect, it } from "vitest";
import { extractPage, pageContext, parseSitemapOrFeed, pinnablePages } from "@/lib/tools/pageExtract";
import { parseShopifyProducts } from "@/lib/tools/sources";
import { FetchBlocked, safeFetch } from "@/lib/tools/safeFetch";

const BLOG = `<!doctype html><html lang="en"><head>
<title>10 Cozy Living Room Ideas | Home Notes</title>
<meta property="og:site_name" content="Home Notes">
<meta property="og:title" content="10 Cozy Living Room Ideas &amp; Tips">
<meta name="description" content="Warm textures, layered lighting and small-space tricks for a cozy living room.">
<meta property="og:image" content="/img/hero.jpg">
<link rel="canonical" href="https://homenotes.example/cozy-living-room">
<script>var x = "<p>not text</p>";</script>
</head><body>
<img src="/logo.png" width="120" height="40" alt="logo">
<h1>10 Cozy Living Room Ideas</h1>
<p>Short.</p>
<p>Start with texture: a chunky knit throw, a wool rug and linen cushions make any sofa feel warmer straight away.</p>
<h2>Layer your lighting</h2><h2>Add a reading nook</h2>
<ul><li>Use warm 2700K bulbs in every lamp</li><li>Hide cables behind the sofa</li></ul>
<img srcset="/img/a-400.jpg 400w, /img/a-1200.jpg 1200w" src="/img/a-400.jpg" alt="Sofa with throw">
<img data-src="/img/b.jpg" alt="Reading nook" width="800" height="1000">
<img src="/img/tiny.jpg" width="100" height="100">
</body></html>`;

const PRODUCT = `<html><head><meta property="og:type" content="product">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Linen Wrap Dress","description":"Breathable linen midi dress.","image":["https://shop.example/d1.jpg","https://shop.example/d2.jpg"],"brand":{"name":"Sahil"},"offers":{"@type":"Offer","price":"49.00","priceCurrency":"USD"}}]}</script>
</head><body><h1>Linen Wrap Dress</h1></body></html>`;

describe("page reader", () => {
  it("reads a blog post: title, summary, points and big photos only", () => {
    const p = extractPage(BLOG, "https://homenotes.example/cozy-living-room?utm=x");
    expect(p.title).toBe("10 Cozy Living Room Ideas & Tips");
    expect(p.siteName).toBe("Home Notes");
    expect(p.canonical).toBe("https://homenotes.example/cozy-living-room");
    expect(p.description).toMatch(/Warm textures/);
    expect(p.keyPoints).toContain("Layer your lighting");
    expect(p.keyPoints).toContain("Use warm 2700K bulbs in every lamp");
    const urls = p.images.map((i) => i.url);
    expect(urls[0]).toBe("https://homenotes.example/img/hero.jpg");
    expect(urls).toContain("https://homenotes.example/img/a-1200.jpg");
    expect(urls).toContain("https://homenotes.example/img/b.jpg");
    expect(urls.join(" ")).not.toMatch(/logo|tiny/);
    expect(p.language).toBe("en");
  });
  it("reads a product: name, price, brand and gallery from JSON-LD", () => {
    const p = extractPage(PRODUCT, "https://shop.example/p/linen");
    expect(p.kind).toBe("product");
    expect(p.title).toBe("Linen Wrap Dress");
    expect(p.price).toBe("49.00 USD");
    expect(p.brand).toBe("Sahil");
    expect(p.images.map((i) => i.url)).toEqual(["https://shop.example/d1.jpg", "https://shop.example/d2.jpg"]);
    expect(pageContext(p)).toMatch(/Price: 49.00 USD/);
  });
});

describe("sitemaps, feeds and stores", () => {
  it("reads a sitemap and drops pages not worth pinning", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://a.example/post-1</loc></url><url><loc>https://a.example/tag/x/</loc></url><url><loc>https://a.example/privacy</loc></url><url><loc>https://a.example/post-2</loc></url></urlset>`;
    const r = parseSitemapOrFeed(xml, "https://a.example/sitemap.xml");
    expect(r.kind).toBe("sitemap");
    expect(pinnablePages(r.urls)).toEqual(["https://a.example/post-1", "https://a.example/post-2"]);
  });
  it("recognises a sitemap index", () => {
    const r = parseSitemapOrFeed(`<sitemapindex><sitemap><loc>https://a.example/post-sitemap.xml</loc></sitemap></sitemapindex>`, "https://a.example/");
    expect(r).toMatchObject({ kind: "index", urls: ["https://a.example/post-sitemap.xml"] });
  });
  it("reads RSS with images", () => {
    const rss = `<rss><channel><item><title><![CDATA[Fall Outfits]]></title><link>https://b.example/fall</link><description><![CDATA[<p>Layer up</p><img src="https://b.example/f.jpg">]]></description><pubDate>Mon, 01 Sep 2026</pubDate></item></channel></rss>`;
    const r = parseSitemapOrFeed(rss, "https://b.example/feed");
    expect(r.kind).toBe("feed");
    expect(r.items[0]).toMatchObject({ url: "https://b.example/fall", title: "Fall Outfits", image: "https://b.example/f.jpg" });
  });
  it("reads Atom", () => {
    const atom = `<feed><entry><title>Post</title><link href="https://c.example/p"/><summary>Hi</summary></entry></feed>`;
    expect(parseSitemapOrFeed(atom, "https://c.example/").items[0].url).toBe("https://c.example/p");
  });
  it("reads a Shopify product list", () => {
    const items = parseShopifyProducts(JSON.stringify({ products: [{ title: "Abaya", handle: "black-abaya", body_html: "<p>Soft crepe</p>", images: [{ src: "https://cdn.example/a.jpg" }], variants: [{ price: "59.00" }] }] }), "https://store.example");
    expect(items[0]).toMatchObject({ url: "https://store.example/products/black-abaya", title: "Abaya", image: "https://cdn.example/a.jpg" });
    expect(items[0].summary).toMatch(/Price 59.00. Soft crepe/);
  });
});

describe("safe fetching", () => {
  it("blocks private addresses, including after a redirect", async () => {
    await expect(safeFetch("http://127.0.0.1/")).rejects.toBeInstanceOf(FetchBlocked);
    await expect(safeFetch("http://10.0.0.5/x")).rejects.toBeInstanceOf(FetchBlocked);
    const redirect = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    await expect(safeFetch("http://93.184.216.34/", { fetchImpl: redirect as typeof fetch })).rejects.toThrow(/private network/);
  });
  it("rejects files over the size limit", async () => {
    const big = async () => new Response(new Uint8Array(2000), { status: 200, headers: { "content-type": "text/html" } });
    await expect(safeFetch("http://93.184.216.34/", { maxBytes: 1000, fetchImpl: big as typeof fetch })).rejects.toThrow(/too large/);
  });
  it("returns the body of a public page", async () => {
    const ok = async () => new Response("<html><title>x</title></html>", { status: 200, headers: { "content-type": "text/html" } });
    const r = await safeFetch("http://93.184.216.34/", { fetchImpl: ok as typeof fetch });
    expect(new TextDecoder().decode(r.bytes)).toMatch(/title/);
  });
});
