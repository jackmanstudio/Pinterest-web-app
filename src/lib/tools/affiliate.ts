import { LIMITS } from "@/lib/drafts/validation";

/** Amazon stores by domain. A tag is set only for stores you fill in. */
export const AMAZON_STORES = [
  { domain: "amazon.com", label: "United States" },
  { domain: "amazon.co.uk", label: "United Kingdom" },
  { domain: "amazon.ca", label: "Canada" },
  { domain: "amazon.com.au", label: "Australia" },
  { domain: "amazon.de", label: "Germany" },
  { domain: "amazon.fr", label: "France" },
  { domain: "amazon.it", label: "Italy" },
  { domain: "amazon.es", label: "Spain" },
  { domain: "amazon.in", label: "India" },
  { domain: "amazon.ae", label: "UAE" },
  { domain: "amazon.sa", label: "Saudi Arabia" },
  { domain: "amazon.co.jp", label: "Japan" },
] as const;

export interface AffiliateSettings {
  /** domain → tracking tag, e.g. { "amazon.com": "mystore-20" } */
  amazonTags: Record<string, string>;
  disclosure: string;
}
export const DEFAULT_AFFILIATE: AffiliateSettings = { amazonTags: {}, disclosure: "#ad · This pin contains affiliate links." };

const TAG_RE = /^[A-Za-z0-9-]{3,40}$/;
export const validTag = (t: string) => TAG_RE.test(t.trim());

/** The Amazon store a link belongs to (www./smile. ignored), or null. */
export function amazonStore(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^(www|smile|m)\./, "");
    return AMAZON_STORES.find((s) => host === s.domain)?.domain ?? null;
  } catch {
    return null;
  }
}

/**
 * Adds or replaces the Amazon associate tag for that link's store, keeping
 * every other parameter. Links to other sites are returned unchanged.
 */
export function applyAmazonTag(raw: string, tags: Record<string, string>): string {
  const store = amazonStore(raw);
  const tag = store ? tags[store]?.trim() : "";
  if (!store || !tag || !validTag(tag)) return raw;
  const u = new URL(raw);
  u.searchParams.set("tag", tag);
  return u.toString();
}

/** Appends the disclosure to a description once (it stays within Pinterest's limit). */
export function addDisclosure(description: string, disclosure: string): string {
  const d = disclosure.trim();
  if (!d) return description;
  const first = d.split(/\s+/)[0].toLowerCase();
  if (description.toLowerCase().includes(d.toLowerCase()) || (first.startsWith("#") && new RegExp(`(^|\\s)${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(description))) return description;
  const room = LIMITS.description - d.length - 1;
  const base = description.length > room ? description.slice(0, Math.max(0, room - 1)).trimEnd() + "…" : description;
  return `${base}\n${d}`.trim();
}

/** Literal find & replace inside a link (e.g. an old domain or a changed affiliate ID). Returns null when the result isn't a valid link. */
export function replaceInLink(raw: string, find: string, replace: string): string | null {
  if (!find) return raw;
  const out = raw.split(find).join(replace);
  try {
    const u = new URL(out);
    return ["http:", "https:"].includes(u.protocol) ? out : null;
  } catch {
    return null;
  }
}

/** Does this pin link to a known affiliate/shop network? Used to suggest the disclosure. */
export function looksAffiliate(raw: string | null): boolean {
  if (!raw) return false;
  if (amazonStore(raw)) return true;
  return /(amzn\.to|shareasale|awin1|rstyle\.me|shopstyle|ltk\.app|liketoknow\.it|go\.skimresources|click\.linksynergy|anrdoezrs|dpbolvw|jdoqocy|tkqlhce|impact\.com|partnerize|clickbank)/i.test(raw) || /[?&](tag|aff|affid|affiliate|ref|refid)=/i.test(raw);
}
