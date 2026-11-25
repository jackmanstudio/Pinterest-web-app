import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext, HttpError } from "@/lib/server/context";
import { rateLimited } from "@/lib/server/rateLimit";
import { listSource } from "@/lib/tools/sourceList";
import { FetchBlocked } from "@/lib/tools/safeFetch";

const Body = z.object({ url: z.string().trim().min(4).max(2048) });

/** Lists pages to pin from a sitemap, RSS/Atom feed or Shopify store. Read-only. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "urlCheck");
  if (limited) return limited;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste a full web address." }, { status: 400 });
  try {
    await getRequestContext();
    const r = await listSource(parsed.data.url);
    if (!r) return NextResponse.json({ error: "No sitemap, RSS/Atom feed or Shopify product list was found there. Paste the sitemap or feed address directly." }, { status: 422 });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof FetchBlocked) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Couldn't read that address." }, { status: 502 });
  }
}
