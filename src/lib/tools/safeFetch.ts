import { assertPublicHost, HostNotFound } from "./urlCheck";

export class FetchBlocked extends Error {}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Fetches a public web address for the server (pages, sitemaps, feeds, images).
 * Blocks private/internal addresses at every redirect hop (SSRF guard), caps
 * redirects, time and size, and never sends cookies or credentials.
 */
export async function safeFetch(
  raw: string,
  opts: { accept?: string; maxBytes?: number; timeoutMs?: number; fetchImpl?: typeof fetch; referer?: string; browserLike?: boolean } = {},
): Promise<SafeResponse> {
  const { accept = "*/*", maxBytes = 3_000_000, timeoutMs = 10_000, fetchImpl = fetch } = opts;
  // Some image CDNs refuse bot user agents or images requested without the page as referer.
  const ua = opts.browserLike
    ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
    : "Mozilla/5.0 (compatible; PinStudioBot/1.0; +pin preview)";
  let referer: string | undefined;
  try {
    referer = opts.referer && /^https?:$/.test(new URL(opts.referer).protocol) ? new URL(opts.referer).toString() : undefined;
  } catch {
    referer = undefined;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchBlocked("That isn't a valid web address.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new FetchBlocked("Only public http(s) addresses can be read.");
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= 5; hop++) {
    try {
      await assertPublicHost(url.hostname);
    } catch (e) {
      if (e instanceof HostNotFound) throw new FetchBlocked(`We couldn't find the website “${e.host}”. Check the address for a typo.`);
      throw new FetchBlocked("That address points to a private network and can't be read.");
    }
    const r = await fetchImpl(url, {
      redirect: "manual",
      signal: deadline,
      headers: { "User-Agent": ua, Accept: accept, ...(referer ? { Referer: referer } : {}) },
    });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      url = new URL(loc, url);
      if (!["http:", "https:"].includes(url.protocol)) throw new FetchBlocked("Redirected to an unsupported address.");
      continue;
    }
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new FetchBlocked(`That file is too large (over ${Math.round(maxBytes / 1e6)} MB).`);
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new FetchBlocked(`That file is too large (over ${Math.round(maxBytes / 1e6)} MB).`);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    return { url: url.toString(), status: r.status, contentType: (r.headers.get("content-type") ?? "").toLowerCase(), bytes };
  }
  throw new FetchBlocked("Too many redirects.");
}
