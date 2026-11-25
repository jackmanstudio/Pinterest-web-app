import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { extractPage } from "@/lib/tools/pageExtract";
import { FetchBlocked, safeFetch } from "@/lib/tools/safeFetch";

const Body = z.object({ url: z.string().trim().min(4).max(2048) });

/** Reads a public page (blog post, product, recipe) and returns what a pin needs. Read-only. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "urlCheck");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste a full web address." }, { status: 400 });
  try {
    await getRequestContext();
    const raw = /^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`;
    const res = await safeFetch(raw, { accept: "text/html,application/xhtml+xml", maxBytes: 4_000_000 });
    if (res.status >= 400) return NextResponse.json({ error: `The page answered with an error (${res.status}). Check the link.` }, { status: 422 });
    if (!/html|xml/.test(res.contentType)) return NextResponse.json({ error: "That link isn't a web page." }, { status: 422 });
    const page = extractPage(new TextDecoder().decode(res.bytes), res.url);
    return NextResponse.json({ page });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof FetchBlocked) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Couldn't read that page. It may block automated visitors or be offline." }, { status: 502 });
  }
}
