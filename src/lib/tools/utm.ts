export interface UtmFields {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

export const UTM_DEFAULTS: UtmFields = { source: "pinterest", medium: "social", campaign: "", content: "", term: "" };

/** Turns "Autumn Trench Coats!" into "autumn-trench-coats". */
export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

/**
 * Adds UTM parameters to a URL, keeping its other query parameters and its
 * #fragment. Empty fields are left out; existing utm_* values are replaced.
 */
export function buildUtmUrl(raw: string, f: UtmFields): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links can be tracked");
  const set = (k: string, v?: string) => {
    const val = (v ?? "").trim();
    if (val) url.searchParams.set(k, val);
  };
  set("utm_source", f.source);
  set("utm_medium", f.medium);
  set("utm_campaign", f.campaign);
  set("utm_content", f.content);
  set("utm_term", f.term);
  return url.toString();
}

/** Reads UTM parameters back out of a URL (for showing what a link already carries). */
export function readUtm(raw: string): Partial<UtmFields> {
  try {
    const p = new URL(raw).searchParams;
    const out: Partial<UtmFields> = {};
    for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
      const v = p.get(`utm_${k}`);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
