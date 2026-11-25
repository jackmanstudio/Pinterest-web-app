import { decodeEntities, type FeedItem } from "./pageExtract";

/** Shopify's public /products.json → items to pin (title, page, first image, price in the summary). */
export function parseShopifyProducts(json: string, origin: string): FeedItem[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const products = (data as { products?: unknown[] })?.products;
  if (!Array.isArray(products)) return [];
  return products
    .map((p) => {
      const o = p as { title?: string; handle?: string; body_html?: string; images?: { src?: string }[]; variants?: { price?: string }[]; updated_at?: string; vendor?: string };
      if (!o.title || !o.handle) return null;
      const text = decodeEntities((o.body_html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      const price = o.variants?.[0]?.price;
      return {
        url: `${origin}/products/${encodeURIComponent(o.handle)}`,
        title: o.title.slice(0, 200),
        summary: `${price ? `Price ${price}. ` : ""}${text}`.slice(0, 400),
        image: o.images?.[0]?.src ?? null,
        published: o.updated_at ?? null,
      } satisfies FeedItem;
    })
    .filter((x): x is FeedItem => x !== null);
}
