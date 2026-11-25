import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface UrlCheckResult {
  url: string;
  syntaxOk: boolean;
  reachable: boolean | null;
  status: number | null;
  finalUrl: string | null;
  redirects: number;
  pageTitle: string | null;
  topicMatch: "match" | "weak" | "unknown";
  messages: string[];
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff");
  }
  return true;
}

export async function assertPublicHost(host: string) {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) throw new Error("private host");
  const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private host");
}

const words = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));

/**
 * Checks a pin's destination (spec 24.5): syntax, whether it answers, redirects,
 * and a rough topic match between the pin title and the page title. Only public
 * addresses are fetched. A 200 response says nothing about safety or compliance.
 */
export async function checkUrl(raw: string, pinTitle = "", fetchImpl: typeof fetch = fetch): Promise<UrlCheckResult> {
  const res: UrlCheckResult = { url: raw, syntaxOk: false, reachable: null, status: null, finalUrl: null, redirects: 0, pageTitle: null, topicMatch: "unknown", messages: [] };
  let url: URL;
  try {
    url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) throw new Error();
    if (url.username || url.password) throw new Error();
  } catch {
    res.messages.push("Not a valid web address. It must start with https:// and include a domain.");
    return res;
  }
  res.syntaxOk = true;
  if (url.protocol === "http:") res.messages.push("Uses http, not https. Browsers may warn visitors.");

  let current = url;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      await assertPublicHost(current.hostname);
      const r = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "PinStudioLinkChecker/1.0", Accept: "text/html,*/*" },
      });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        if (hop === 5) {
          res.messages.push("Too many redirects (more than 5).");
          res.reachable = false;
          return res;
        }
        res.redirects++;
        current = new URL(loc, current);
        continue;
      }
      res.status = r.status;
      res.finalUrl = current.toString();
      res.reachable = r.status >= 200 && r.status < 300;
      if (r.status === 401 || r.status === 403 || r.status === 429)
        res.messages.push(`The site answered ${r.status}; it may block automated checks. Open it yourself to confirm.`);
      else if (!res.reachable) res.messages.push(`The page answered with status ${r.status}.`);
      if (res.reachable && (r.headers.get("content-type") ?? "").includes("html")) {
        const html = (await r.text()).slice(0, 200_000);
        const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        res.pageTitle = m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : null;
      }
      break;
    }
  } catch (e) {
    const msg = (e as Error).message;
    res.reachable = false;
    res.messages.push(
      msg === "private host"
        ? "This address points to a private or local network, so it was not checked."
        : (e as Error).name === "TimeoutError"
          ? "The page did not answer within 8 seconds."
          : "Could not reach the page (network error, bad domain or bot protection).",
    );
    return res;
  }
  if (res.redirects) res.messages.push(`Redirected ${res.redirects} time(s) to ${res.finalUrl}.`);
  if (res.pageTitle && pinTitle) {
    const a = words(pinTitle);
    const b = words(res.pageTitle);
    const shared = [...a].filter((w) => b.has(w));
    res.topicMatch = shared.length ? "match" : "weak";
    if (!shared.length) res.messages.push("The page title shares no keywords with the pin title. Check that the link matches the pin.");
  }
  if (res.reachable && !res.messages.length) res.messages.push("The page answered normally.");
  return res;
}
