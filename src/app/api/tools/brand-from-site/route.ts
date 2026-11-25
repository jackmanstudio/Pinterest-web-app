import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { extractPage } from "@/lib/tools/pageExtract";
import { FetchBlocked, safeFetch } from "@/lib/tools/safeFetch";

const Body = z.object({ url: z.string().trim().min(4).max(2048) });

/** Logo as a small PNG data URL (fits the pin template's size limit), or null. */
async function logoDataUrl(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    try {
      const r = await safeFetch(u, { accept: "image/png,image/jpeg,image/webp,image/svg+xml,image/*", maxBytes: 2_000_000, timeoutMs: 8000 });
      if (r.status >= 400) continue;
      const img = sharp(r.bytes, { density: 200 });
      const meta = await img.metadata();
      if (!meta.width || meta.width < 64) continue;
      const png = await img.resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
      if (png.length > 250_000) continue;
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Brand analysis from a website: name, description, keywords, colour and logo,
 * as suggestions the user reviews before saving. Read-only.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "urlCheck");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your website address first." }, { status: 400 });
  try {
    await getRequestContext();
    const url = /^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`;
    const res = await safeFetch(url, { accept: "text/html", maxBytes: 4_000_000 });
    if (res.status >= 400 || !/html/.test(res.contentType)) return NextResponse.json({ error: `Couldn't open that website (${res.status}).` }, { status: 422 });
    const page = extractPage(new TextDecoder().decode(res.bytes), res.url);
    const name = page.siteName ?? page.title.split(/\s[|–—-]\s/)[0].trim();
    return NextResponse.json({
      brand_name: name.slice(0, 80),
      description: page.description,
      keywords: page.keywords.length ? page.keywords : page.headings.slice(0, 5).map((h) => h.toLowerCase()).filter((h) => h.length < 30),
      color: page.themeColor,
      logo: await logoDataUrl(page.logos),
      language: page.language,
      website_url: new URL(res.url).origin,
    });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof FetchBlocked) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Couldn't read that website. It may block automated visitors." }, { status: 502 });
  }
}
